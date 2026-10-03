// Read the mainnet Chainlink NVDA/USD feed on Robinhood Chain (4663) and write src/feed.json for the cold open.
// Re-run right before the final render: the card prints the literal cast output and the UTC time of the read.
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
const FEED = "0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15";
const RPC = "https://rpc.mainnet.chain.robinhood.com";
const cmd = `cast call ${FEED} 'latestRoundData()(uint80,int256,uint256,uint256,uint80)' --rpc-url ${RPC}`;
const out = execSync(cmd, { encoding: "utf8" }).trim().split("\n");
const desc = execSync(`cast call ${FEED} 'description()(string)' --rpc-url ${RPC}`, { encoding: "utf8" }).trim();
const readAt = Math.floor(Date.now() / 1000);
const updatedAt = Number(out[3].split(" ")[0]);
const answer = Number(out[1].split(" ")[0]) / 1e8;
const ageH = (readAt - updatedAt) / 3600;
const res = { feed: FEED, description: desc, command: `cast call ${FEED.slice(0, 6)}…${FEED.slice(-4)} 'latestRoundData()' --rpc-url rpc.mainnet.chain.robinhood.com`, lines: out, answer, updatedAt, updatedAtUtc: new Date(updatedAt * 1000).toUTCString(), readAt, readAtUtc: new Date(readAt * 1000).toUTCString(), ageHours: Math.round(ageH * 10) / 10 };
writeFileSync(new URL("../src/feed.json", import.meta.url), JSON.stringify(res, null, 2) + "\n");
console.log(JSON.stringify(res, null, 2));
