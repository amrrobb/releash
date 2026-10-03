// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {AggregatorV3Interface} from "./interfaces/AggregatorV3Interface.sol";
import {IPool} from "./interfaces/IPool.sol";

/// @title ReleashVault
/// @notice USDG loans against one tokenized stock, with an agent whose authority is asymmetric:
/// it may ADD debt only up to a ceiling that halves every `halfLife` unless the borrower renews
/// it with a World ID proof, and it may REDUCE debt (deleverage) at any time, even after the
/// borrower revoked it or the ceiling decayed to zero. "Close always, open only while alive."
/// @dev There is no owner or admin. Nobody but the borrower and their agent can change a position,
/// except a liquidator once the position is unhealthy.
contract ReleashVault is ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    // ---------------------------------------------------------------- parameters

    uint256 public constant BPS = 10_000;
    /// @notice Borrowing (by anyone) may not push LTV above this.
    uint256 public constant MAX_LTV_BPS = 5_000;
    /// @notice Above this LTV anyone may liquidate.
    uint256 public constant LIQ_THRESHOLD_BPS = 7_000;
    uint256 public constant LIQ_BONUS_BPS = 500;
    uint256 public constant CLOSE_FACTOR_BPS = 5_000;
    /// @notice When the AGENT deleverages, the collateral it sells may cost at most this much more
    /// than the oracle-fair amount, so an agent cannot dump a position into a manipulated pool.
    uint256 public constant MAX_DELEVERAGE_SLIPPAGE_BPS = 1_500;
    /// @notice Borrow and withdraw need a price at most this old. Deleverage and liquidation do not:
    /// a frozen weekend price is exactly when de-risking has to keep working.
    uint256 public constant MAX_PRICE_AGE = 3 days;
    /// @notice Authority is zero after this many half-lives (plain halving would take ~30).
    uint256 public constant CUTOFF_HALVINGS = 3;

    uint16 public constant DELEVERAGE_SMALL = 1_000;
    uint16 public constant DELEVERAGE_LARGE = 3_000;

    bytes32 public constant RENEWAL_TYPEHASH =
        keccak256("Renewal(address owner,address agent,uint64 issuedAt,uint64 deadline)");

    /// @dev collateral (18 dec) * price (8 dec) / 1e20 = USDG (6 dec).
    uint256 internal constant VALUE_SCALE = 1e20;

    IERC20 public immutable collateral;
    IERC20 public immutable debtAsset;
    AggregatorV3Interface public immutable feed;
    IPool public immutable pool;
    /// @notice Backend key that signs a Renewal after verifying a World ID proof server side.
    address public immutable worldSigner;
    /// @notice 1 days in production, 60 seconds on the demo deployment.
    uint256 public immutable halfLife;

    // ---------------------------------------------------------------- state

    struct Position {
        uint128 collateral;
        uint128 debt;
    }

    struct Mandate {
        address agent;
        /// @notice Max debt (USDG) the agent may bring the position to, at full strength.
        uint128 authorityBase;
        /// @notice issuedAt of the latest accepted World renewal; 0 = never renewed.
        uint64 lastRenewed;
        /// @notice Agent may not add debt. Deleverage is unaffected.
        bool revoked;
    }

    struct Renewal {
        address owner;
        address agent;
        uint64 issuedAt;
        uint64 deadline;
    }

    mapping(address owner => Position) public positions;
    mapping(address owner => Mandate) public mandates;
    /// @notice A renewal must be issued strictly after this. Raised by revoke, fire and agent
    /// changes, and never reset, so no signature issued before those can ever be submitted later.
    mapping(address owner => uint64) public renewalFloor;

    // ---------------------------------------------------------------- events

    event Funded(address indexed from, uint256 amount);
    event Deposited(address indexed owner, uint256 amount);
    event Withdrawn(address indexed owner, uint256 amount);
    event Borrowed(address indexed owner, address indexed by, uint256 amount, uint256 newDebt);
    event Repaid(address indexed owner, address indexed payer, uint256 amount, uint256 newDebt);
    event MandateSet(address indexed owner, address indexed agent, uint256 authorityBase);
    event Revoked(address indexed owner);
    event Fired(address indexed owner, address indexed agent);
    event Renewed(address indexed owner, address indexed agent, uint64 issuedAt);
    event Deleveraged(
        address indexed owner, address indexed by, uint16 bps, uint256 collateralSold, uint256 debtRepaid
    );
    event Liquidated(address indexed owner, address indexed liquidator, uint256 debtRepaid, uint256 collateralSeized);

    // ---------------------------------------------------------------- errors

    error ZeroAmount();
    error ZeroAgent();
    error NotAgent();
    error NotOwnerOrAgent();
    error MandateRevoked();
    error AuthorityExceeded(uint256 newDebt, uint256 authority);
    error LtvExceeded(uint256 ltvBps);
    error StalePrice(uint256 updatedAt);
    error BadPrice();
    error BadSignature();
    error RenewalNotNewer();
    error RenewalExpired();
    error RenewalFromFuture();
    error AgentMismatch();
    error BadBps();
    error SlippageExceeded(uint256 collateralIn, uint256 limit);
    error InsufficientCollateral();
    error InsufficientLiquidity();
    error Healthy();
    error RepayTooLarge();
    error NoDebt();

    constructor(
        IERC20 collateral_,
        IERC20 debtAsset_,
        AggregatorV3Interface feed_,
        IPool pool_,
        address worldSigner_,
        uint256 halfLife_
    ) EIP712("Releash", "1") {
        require(halfLife_ > 0, ZeroAmount());
        collateral = collateral_;
        debtAsset = debtAsset_;
        feed = feed_;
        pool = pool_;
        worldSigner = worldSigner_;
        halfLife = halfLife_;
    }

    // ---------------------------------------------------------------- liquidity

    /// @notice Adds USDG the vault can lend. No interest, no shares: testnet liquidity only.
    function fund(uint256 amount) external nonReentrant {
        require(amount > 0, ZeroAmount());
        debtAsset.safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(msg.sender, amount);
    }

    // ---------------------------------------------------------------- borrower

    function deposit(uint128 amount) external nonReentrant {
        require(amount > 0, ZeroAmount());
        positions[msg.sender].collateral += amount;
        collateral.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    function withdraw(uint128 amount) external nonReentrant {
        require(amount > 0, ZeroAmount());
        Position storage p = positions[msg.sender];
        require(amount <= p.collateral, InsufficientCollateral());
        p.collateral -= amount;
        if (p.debt > 0) _requireLtv(p, _freshPrice());
        collateral.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function borrow(uint128 amount) external nonReentrant {
        _borrow(msg.sender, amount);
    }

    /// @notice Anyone may repay anyone's debt.
    function repay(address owner, uint128 amount) external nonReentrant {
        Position storage p = positions[owner];
        require(amount > 0, ZeroAmount());
        require(amount <= p.debt, RepayTooLarge());
        p.debt -= amount;
        debtAsset.safeTransferFrom(msg.sender, address(this), amount);
        emit Repaid(owner, msg.sender, amount, p.debt);
    }

    /// @notice Appoints an agent (or changes its authority). A different agent starts unrenewed:
    /// it needs a fresh World proof before it can add any debt.
    function setMandate(address agent, uint128 authorityBase) external {
        require(agent != address(0), ZeroAgent());
        Mandate storage m = mandates[msg.sender];
        if (m.agent != agent) {
            if (m.agent != address(0)) renewalFloor[msg.sender] = uint64(block.timestamp);
            m.agent = agent;
            m.lastRenewed = 0;
        }
        m.authorityBase = authorityBase;
        m.revoked = false;
        emit MandateSet(msg.sender, agent, authorityBase);
    }

    /// @notice Stops the agent from adding debt, instantly. It can still deleverage.
    function revoke() external {
        mandates[msg.sender].revoked = true;
        renewalFloor[msg.sender] = uint64(block.timestamp);
        emit Revoked(msg.sender);
    }

    /// @notice Removes the agent entirely, including its right to deleverage.
    function fire() external {
        address agent = mandates[msg.sender].agent;
        delete mandates[msg.sender];
        renewalFloor[msg.sender] = uint64(block.timestamp);
        emit Fired(msg.sender, agent);
    }

    // ---------------------------------------------------------------- renewal

    /// @notice Restarts the agent's decay clock. Anyone may submit; the World signer attests that a
    /// unique human bound to `r.owner` proved presence at `r.issuedAt`. Strictly increasing
    /// issuedAt makes every signature single-use.
    function renew(Renewal calldata r, bytes calldata sig) external {
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(renewalDigest(r), sig);
        require(err == ECDSA.RecoverError.NoError && signer == worldSigner, BadSignature());
        Mandate storage m = mandates[r.owner];
        require(r.agent == m.agent && r.agent != address(0), AgentMismatch());
        require(r.issuedAt > m.lastRenewed && r.issuedAt > renewalFloor[r.owner], RenewalNotNewer());
        require(r.issuedAt <= block.timestamp, RenewalFromFuture());
        require(block.timestamp <= r.deadline, RenewalExpired());
        m.lastRenewed = r.issuedAt;
        renewalFloor[r.owner] = r.issuedAt;
        m.revoked = false;
        emit Renewed(r.owner, r.agent, r.issuedAt);
    }

    // ---------------------------------------------------------------- agent

    /// @notice Adds debt on the owner's behalf. The USDG goes to the owner, never the agent.
    function agentBorrow(address owner, uint128 amount) external nonReentrant {
        Mandate storage m = mandates[owner];
        require(msg.sender == m.agent && m.agent != address(0), NotAgent());
        require(!m.revoked, MandateRevoked());
        uint256 authority = authorityNow(owner);
        uint256 newDebt = uint256(positions[owner].debt) + amount;
        require(newDebt <= authority, AuthorityExceeded(newDebt, authority));
        _borrow(owner, amount);
    }

    /// @notice Repays `bps` of the debt by selling collateral into the pool. Callable by the owner or
    /// the agent at any time: reads no authority, decay or revoke state.
    /// @param maxCollateralIn Caller's slippage bound.
    function deleverage(address owner, uint16 bps, uint128 maxCollateralIn) external nonReentrant {
        bool byAgent = msg.sender != owner;
        if (byAgent) require(msg.sender == mandates[owner].agent && msg.sender != address(0), NotOwnerOrAgent());
        require(bps == DELEVERAGE_SMALL || bps == DELEVERAGE_LARGE, BadBps());

        Position storage p = positions[owner];
        uint256 target = uint256(p.debt) * bps / BPS;
        require(target > 0, NoDebt());

        uint256 colIn = pool.getAmountIn(address(debtAsset), target);
        require(colIn <= maxCollateralIn, SlippageExceeded(colIn, maxCollateralIn));
        require(colIn <= p.collateral, InsufficientCollateral());
        if (byAgent) {
            uint256 fair = target * VALUE_SCALE / _price();
            uint256 limit = fair * (BPS + MAX_DELEVERAGE_SLIPPAGE_BPS) / BPS;
            require(colIn <= limit, SlippageExceeded(colIn, limit));
        }

        p.collateral -= colIn.toUint128();
        collateral.forceApprove(address(pool), colIn);
        uint256 out = pool.swapExactIn(address(collateral), colIn, target, address(this));

        uint256 repaid = out < p.debt ? out : p.debt;
        p.debt -= repaid.toUint128();
        if (out > repaid) debtAsset.safeTransfer(owner, out - repaid);
        emit Deleveraged(owner, msg.sender, bps, colIn, repaid);
        emit Repaid(owner, msg.sender, repaid, p.debt);
    }

    // ---------------------------------------------------------------- liquidation

    /// @notice Anyone may repay up to half the debt of an unhealthy position and seize collateral at
    /// the oracle price plus a bonus. Uses the latest price even if stale.
    function liquidate(address owner, uint128 repayAmount) external nonReentrant {
        Position storage p = positions[owner];
        uint256 price = _price();
        require(_liquidatable(p, price), Healthy());
        require(repayAmount > 0, ZeroAmount());
        require(uint256(repayAmount) * BPS <= uint256(p.debt) * CLOSE_FACTOR_BPS, RepayTooLarge());

        uint256 seize = uint256(repayAmount) * VALUE_SCALE / price * (BPS + LIQ_BONUS_BPS) / BPS;
        if (seize > p.collateral) {
            // Not enough collateral for the bonus: take all of it and charge only what it is worth.
            seize = p.collateral;
            repayAmount = (seize * price / VALUE_SCALE * BPS / (BPS + LIQ_BONUS_BPS)).toUint128();
            require(repayAmount > 0, ZeroAmount());
        }

        p.debt -= repayAmount;
        p.collateral -= seize.toUint128();
        debtAsset.safeTransferFrom(msg.sender, address(this), repayAmount);
        collateral.safeTransfer(msg.sender, seize);
        emit Liquidated(owner, msg.sender, repayAmount, seize);
        emit Repaid(owner, msg.sender, repayAmount, p.debt);
    }

    // ---------------------------------------------------------------- views

    /// @notice Max debt the agent may bring the position to right now.
    function authorityNow(address owner) public view returns (uint256) {
        Mandate memory m = mandates[owner];
        if (m.agent == address(0) || m.revoked || m.lastRenewed == 0) return 0;
        return limitAt(m.authorityBase, block.timestamp - m.lastRenewed);
    }

    /// @notice Halves every half-life, interpolates linearly toward the next halving inside a
    /// period, and is zero from CUTOFF_HALVINGS half-lives on.
    function limitAt(uint256 base, uint256 elapsed) public view returns (uint256) {
        uint256 periods = elapsed / halfLife;
        if (periods >= CUTOFF_HALVINGS) return 0;
        uint256 halved = base >> periods;
        return halved - halved * (elapsed % halfLife) / (2 * halfLife);
    }

    /// @notice Seconds until authority next halves (0 if it is already zero).
    function nextHalvingIn(address owner) external view returns (uint256) {
        if (authorityNow(owner) == 0) return 0;
        return halfLife - (block.timestamp - mandates[owner].lastRenewed) % halfLife;
    }

    function price() external view returns (uint256 price8, uint256 updatedAt) {
        (, int256 answer,, uint256 at,) = feed.latestRoundData();
        require(answer > 0, BadPrice());
        // forge-lint: disable-next-line(unsafe-typecast)
        return (uint256(answer), at);
    }

    function collateralValue(address owner) public view returns (uint256) {
        return uint256(positions[owner].collateral) * _price() / VALUE_SCALE;
    }

    function healthOf(address owner)
        external
        view
        returns (uint256 value, uint256 debt, uint256 ltvBps, bool liquidatable)
    {
        Position memory p = positions[owner];
        uint256 px = _price();
        value = uint256(p.collateral) * px / VALUE_SCALE;
        debt = p.debt;
        ltvBps = _ltvBps(p, px);
        liquidatable = _liquidatable(p, px);
    }

    function renewalDigest(Renewal calldata r) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(RENEWAL_TYPEHASH, r.owner, r.agent, r.issuedAt, r.deadline)));
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ---------------------------------------------------------------- internal

    function _borrow(address owner, uint128 amount) internal {
        require(amount > 0, ZeroAmount());
        require(debtAsset.balanceOf(address(this)) >= amount, InsufficientLiquidity());
        Position storage p = positions[owner];
        p.debt += amount;
        _requireLtv(p, _freshPrice());
        debtAsset.safeTransfer(owner, amount);
        emit Borrowed(owner, msg.sender, amount, p.debt);
    }

    /// @dev Compares by cross-multiplication so a rounded-down LTV can never let a borrow through.
    function _requireLtv(Position storage p, uint256 px) internal view {
        uint256 value = uint256(p.collateral) * px / VALUE_SCALE;
        require(uint256(p.debt) * BPS <= value * MAX_LTV_BPS, LtvExceeded(_ltvBps(p, px)));
    }

    function _liquidatable(Position memory p, uint256 px) internal pure returns (bool) {
        uint256 value = uint256(p.collateral) * px / VALUE_SCALE;
        return uint256(p.debt) * BPS > value * LIQ_THRESHOLD_BPS;
    }

    /// @dev Rounded up, so a displayed LTV is never rosier than the truth. type(uint256).max when
    /// there is debt but no collateral.
    function _ltvBps(Position memory p, uint256 px) internal pure returns (uint256) {
        if (p.debt == 0) return 0;
        uint256 value = uint256(p.collateral) * px / VALUE_SCALE;
        if (value == 0) return type(uint256).max;
        return Math.ceilDiv(uint256(p.debt) * BPS, value);
    }

    function _price() internal view returns (uint256) {
        (, int256 answer,,,) = feed.latestRoundData();
        require(answer > 0, BadPrice());
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint256(answer);
    }

    function _freshPrice() internal view returns (uint256) {
        (, int256 answer,, uint256 updatedAt,) = feed.latestRoundData();
        require(answer > 0, BadPrice());
        require(block.timestamp - updatedAt <= MAX_PRICE_AGE, StalePrice(updatedAt));
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint256(answer);
    }
}
