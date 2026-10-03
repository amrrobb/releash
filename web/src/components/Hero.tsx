export function Hero() {
  return (
    <section className="hero" aria-labelledby="hero-h">
      <div className="hero__copy">
        <p className="eyebrow">Auto-deleverage for tokenized-stock loans</p>
        <h1 id="hero-h">
          Close always.
          <br />
          <span>Open only while you're alive.</span>
        </h1>
        <p className="hero__lede">
          Your agent can always make your loan safer. Its power to add debt halves every half-life until you prove,
          with World ID, that you're still there.
        </p>
      </div>
      <ol className="weekend" aria-label="The Friday to Monday problem">
        <li>
          <span className="weekend__day">Fri 16:00</span>
          <strong>Market closes.</strong> The stock stops trading. The on-chain price freezes, your loan doesn't.
        </li>
        <li>
          <span className="weekend__day">Sat – Sun</span>
          <strong>You're offline.</strong> News breaks. Nobody can trade the stock, nobody watches your position.
        </li>
        <li className="weekend__gap">
          <span className="weekend__day">Mon 09:30</span>
          <strong>Gap down −35%.</strong> Without Releash: liquidated at the open. With it: the agent de-risked on Friday.
        </li>
      </ol>
      <p className="builton">Built on Robinhood Chain · USDG · World ID</p>
    </section>
  );
}
