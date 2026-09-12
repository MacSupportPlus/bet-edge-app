import Link from "next/link";
import type { ReactNode } from "react";
import { Callout } from "./Callout";

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 flex flex-col gap-4">
      <h2 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function SubHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
      {children}
    </h3>
  );
}

function Field({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="shrink-0 font-medium sm:w-48" style={{ color: "var(--text-primary)" }}>
        {term}
      </dt>
      <dd style={{ color: "var(--text-secondary)" }}>{children}</dd>
    </div>
  );
}

/** A big, numbered, literal step — for the beginner checklist, where every click matters. */
function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
        style={{ background: "var(--series-1)" }}
      >
        {n}
      </span>
      <span className="pt-0.5" style={{ color: "var(--text-secondary)" }}>
        {children}
      </span>
    </li>
  );
}

function ChecklistGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border p-4" style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}>
      <h3 className="mb-3 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
        {title}
      </h3>
      <ol className="flex flex-col gap-3">{children}</ol>
    </div>
  );
}

const jumpLinks = [
  { href: "#checklist", label: "Start here (no experience needed)" },
  { href: "#big-picture", label: "The big picture" },
  { href: "#home", label: "Home" },
  { href: "#matchup", label: "Research: Matchup" },
  { href: "#this-week", label: "Research: This Week" },
  { href: "#team-player", label: "Research: Team & Player" },
  { href: "#games-rankings", label: "Research: Games & Rankings" },
  { href: "#props", label: "Research: Props" },
  { href: "#trends", label: "Trends" },
  { href: "#calculator", label: "Tracker: Edge Calculator" },
  { href: "#simulator", label: "Tracker: Risk of Ruin" },
  { href: "#tracker", label: "Tracker: Bets & CLV" },
  { href: "#model", label: "Guide: Probability Model" },
  { href: "#key-ideas", label: "Key ideas to remember" },
];

export function Guide() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
          Guide: how to actually use this app
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          One job, five destinations: turn a probability estimate into a safe, honest answer about
          whether to bet and how much. Nothing here predicts winners — you (or the model, or the
          automated This Week tab) supply the probability, Research helps you stress-test it and
          dig into any team, player, or trend yourself, and Tracker is about sizing and survival.
        </p>
      </div>

      <nav className="flex flex-wrap gap-2 rounded-lg border p-3" style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}>
        {jumpLinks.map((l) => (
          <a
            key={l.href}
            href={l.href}
            className="rounded-full border px-3 py-1 text-xs"
            style={{ borderColor: "var(--card-border)", color: "var(--text-secondary)" }}
          >
            {l.label}
          </a>
        ))}
      </nav>

      <Section id="checklist" title="Start here: your weekly checklist (no experience needed)">
        <p style={{ color: "var(--text-secondary)" }}>
          This section assumes you know nothing about betting math, probability, or any of the
          terms elsewhere on this page. Just follow the numbered steps in order, every week.
        </p>

        <Callout kind="warning">
          This app never places bets and never touches real money. You place every bet yourself,
          on your own sportsbook, with your own money. Only bet what you can genuinely afford to
          lose. Every recommendation here is a probability, not a promise — you will lose some
          bets even when the app is working exactly as intended, and that&apos;s normal, not a
          sign something&apos;s broken.
        </Callout>

        <ChecklistGroup title="Part 1 — One-time setup">
          <Step n={1}>
            Click <strong style={{ color: "var(--text-primary)" }}>Tracker</strong> at the top of
            the page — it opens on the bet log (&quot;Bets &amp; CLV&quot;) tab by default.
          </Step>
          <Step n={2}>
            At the top, find the box labeled <strong style={{ color: "var(--text-primary)" }}>Starting bankroll</strong>. Type
            in the total amount of money you&apos;re setting aside for betting — for example,
            2000 for $2,000. This is just a number you type once; the app doesn&apos;t connect to
            any real bank account or sportsbook.
          </Step>
          <Step n={3}>
            That&apos;s it for setup. This number is saved automatically in your own browser, so
            you don&apos;t need to enter it again.
          </Step>
        </ChecklistGroup>

        <ChecklistGroup title="Part 2 — Whenever you want to find a bet this week">
          <Step n={1}>
            Click <strong style={{ color: "var(--text-primary)" }}>Research</strong>, then the{" "}
            <strong style={{ color: "var(--text-primary)" }}>This Week</strong> sub-tab, then pick
            a sport (college football or NFL).
          </Step>
          <Step n={2}>
            Wait a few seconds. You&apos;ll see a message saying it&apos;s fetching this
            week&apos;s games — that&apos;s normal, it&apos;s checking real, live game data.
          </Step>
          <Step n={3}>
            Look at the section titled something like &quot;N edges found.&quot; Each box below
            it is one suggested bet, showing a team name, a green{" "}
            <strong style={{ color: "var(--text-primary)" }}>BET</strong> label, and some numbers.
          </Step>
          <Step n={4}>
            You don&apos;t need to understand every number. The two that matter most: &quot;Expected
            value&quot; (bigger is better — it&apos;s the app&apos;s estimate of how favorable
            this bet is) and &quot;Recommended stake&quot; (how much money the app suggests
            betting, based on the bankroll number you typed in Part 1).
          </Step>
          <Step n={5}>
            Ignore the collapsed sections further down (&quot;games flagged,&quot; &quot;no
            edge,&quot; &quot;skipped&quot;) — those are the app specifically telling you{" "}
            <em>not</em> to bet on those games. You can click on them out of curiosity, but
            there&apos;s nothing to act on there.
          </Step>
          <Step n={6}>
            Pick one (or none) of the suggested bets. Nothing forces you to bet on every
            suggestion, or to bet at all.
          </Step>
        </ChecklistGroup>

        <ChecklistGroup title="Part 3 — After you decide to bet">
          <Step n={1}>Go place the actual bet yourself, for real money, on whatever sportsbook or app you use.</Step>
          <Step n={2}>
            Come back here and click the blue{" "}
            <strong style={{ color: "var(--text-primary)" }}>Log this bet in the Tracker</strong>{" "}
            button on that same box.
          </Step>
          <Step n={3}>
            You&apos;ll land on Tracker&apos;s Bets &amp; CLV tab with a form already mostly filled
            in for you. Double-check the &quot;Stake ($)&quot; box matches the amount you actually
            bet — if you bet a different amount than what was suggested, change that number to
            match reality. Being honest here is what makes the rest of this useful.
          </Step>
          <Step n={4}>
            Click the blue <strong style={{ color: "var(--text-primary)" }}>Log bet</strong>{" "}
            button. Your bet now shows up at the bottom of the page, labeled{" "}
            <strong style={{ color: "var(--text-primary)" }}>pending</strong>.
          </Step>
        </ChecklistGroup>

        <ChecklistGroup title="Part 4 — After the game finishes">
          <Step n={1}>Come back to Tracker&apos;s Bets &amp; CLV tab.</Step>
          <Step n={2}>
            Find your bet in the list — it still says &quot;pending,&quot; or has already
            auto-settled if it was logged from a This Week/Research card (see below).
          </Step>
          <Step n={3}>
            If it&apos;s still pending, click <strong style={{ color: "var(--status-good)" }}>Win</strong>{" "}
            if you won the bet, or <strong style={{ color: "var(--status-critical)" }}>Loss</strong> if
            you didn&apos;t. That&apos;s the only thing you need to do — everything else updates on
            its own.
          </Step>
        </ChecklistGroup>

        <ChecklistGroup title="Part 5 — Checking how you're actually doing (do this anytime)">
          <Step n={1}>On Tracker&apos;s Bets &amp; CLV tab, look at the row of numbers near the top.</Step>
          <Step n={2}>
            <strong style={{ color: "var(--text-primary)" }}>Current bankroll</strong> is how much
            money you have right now, based on every bet you&apos;ve logged and settled.
          </Step>
          <Step n={3}>
            <strong style={{ color: "var(--text-primary)" }}>Total P&amp;L</strong> means total
            profit and loss — a plus number means you&apos;re up overall, a minus number means
            you&apos;re down.
          </Step>
          <Step n={4}>
            <strong style={{ color: "var(--text-primary)" }}>Win rate</strong> is simply the
            percentage of your settled bets you&apos;ve won.
          </Step>
          <Step n={5}>
            Now look at the chart titled{" "}
            <strong style={{ color: "var(--text-primary)" }}>Realized vs. theoretical bankroll</strong>. The
            solid blue line is what actually happened to your money, bet by bet. The dashed
            orange line shows what would have happened if every single bet had been sized exactly
            the way the app recommended. If the blue line is running{" "}
            <em>below</em> the dashed line, you&apos;ve generally been betting bigger amounts than
            recommended (which raises risk); if it&apos;s running <em>above</em>, you&apos;ve been
            more cautious than recommended. Neither is &quot;wrong&quot; — it&apos;s just an
            honest picture of what you&apos;re actually doing versus what the app suggested.
          </Step>
        </ChecklistGroup>

        <Callout kind="tip">
          That&apos;s the whole loop: check This Week → place a real bet → log it → settle it once
          it&apos;s over → glance at your numbers. Repeat every week. Everything else on this page
          explains the reasoning behind the numbers, and every other tool available, for whenever
          you&apos;re curious — you never have to read it to use the app.
        </Callout>
      </Section>

      <Section id="big-picture" title="The big picture">
        <p style={{ color: "var(--text-secondary)" }}>
          The tools are meant to be used together, roughly in this order, whenever you&apos;re
          considering a real bet:
        </p>
        <ol className="flex flex-col gap-2 pl-5" style={{ color: "var(--text-secondary)" }}>
          <li className="list-decimal">
            <strong style={{ color: "var(--text-primary)" }}>Get a probability.</strong> Either your
            own honest estimate of the win chance, or a starting point from the{" "}
            <Link href="/model" className="underline">
              Probability Model
            </Link>{" "}
            if it&apos;s NFL or college football.
          </li>
          <li className="list-decimal">
            <strong style={{ color: "var(--text-primary)" }}>Check the edge.</strong> Plug that
            probability and the odds into the{" "}
            <Link href="/calculator" className="underline">
              Edge Calculator
            </Link>
            . If it says no edge, stop — don&apos;t bet. If there&apos;s an edge, it tells you the
            Kelly-recommended stake.
          </li>
          <li className="list-decimal">
            <strong style={{ color: "var(--text-primary)" }}>Stress-test the sizing rule</strong>{" "}
            (optional, but worth doing once). Use{" "}
            <Link href="/simulator" className="underline">
              Risk of Ruin
            </Link>{" "}
            with your typical edge size to see what your chosen stake fraction actually does
            to a bankroll over hundreds of bets, and how often it goes bust.
          </li>
          <li className="list-decimal">
            <strong style={{ color: "var(--text-primary)" }}>Place the bet, then log it</strong> in
            the{" "}
            <Link href="/tracker" className="underline">
              Tracker
            </Link>
            . Settle it as a win or loss once it resolves, and let it keep an honest running
            record of how you&apos;re actually doing.
          </li>
        </ol>
        <Callout kind="tip">
          For NFL or college football specifically,{" "}
          <Link href="/this-week" className="underline">
            This Week
          </Link>{" "}
          automates steps 1 and 2 — it pulls this week&apos;s games and live odds itself and
          shows you only the ones worth a look. You still don&apos;t need the Probability Model
          (or This Week) to use this app at all — with your own view on a game&apos;s win
          probability, skip straight to the Edge Calculator with your own number.
        </Callout>
      </Section>

      <Section id="home" title="Home">
        <p style={{ color: "var(--text-secondary)" }}>
          The Command Center. Star any team or player — on their own page, or on a Trends card —
          and it shows up here with live context: a team&apos;s current rank and next opponent, a
          player&apos;s last game line. This becomes your own dashboard instead of a generic
          landing page. Nothing starred yet? It just shows an &quot;Explore&quot; grid straight to
          every tool below.
        </p>
      </Section>

      <Section id="matchup" title="Research: Matchup">
        <p style={{ color: "var(--text-secondary)" }}>
          Everything the model sees for a specific matchup, laid out for you to dig into yourself
          — not to replace your own judgment, but to give it something real to work with. Open it
          from a{" "}
          <strong style={{ color: "var(--text-primary)" }}>Research this game</strong> link on any
          card in This Week (including flagged and no-edge games — an automated &quot;no edge&quot;
          call just means the model and the market agree, not that there&apos;s nothing worth a
          closer look), or pick any two teams yourself on the Matchup tab directly.
        </p>

        <SubHeading>What&apos;s on the page</SubHeading>
        <dl className="flex flex-col gap-2">
          <Field term="Is this a good bet?">
            The same pick/stake check as This Week, but for any matchup you research — not just the
            ones ESPN has live odds for, and not just moneyline. If you opened this page from a
            This Week card, the moneylines are pre-filled from the live odds already; every field
            is always editable, so you can check a line you found elsewhere or a purely
            hypothetical one. Enter a spread and/or total line (both sides default to standard
            -110, editable if you have the real price) and each gets its own real cover/over
            probability and Kelly stake, exactly like moneyline — using the actual historical
            spread of outcomes for that model (distribution-free, not a bell-curve assumption)
            rather than pretending the point estimate itself is precise. &quot;Model implies&quot;
            still shows the bare point estimate above the check — checked against real historical
            market lines, that estimate alone runs about 8 spread points / 4 total points off the
            real number on average (sometimes much more), which is exactly why the check below
            asks how far the line sits from the model&apos;s whole range of likely outcomes
            instead of trusting the single number.
          </Field>
          <Field term="Model probability, decomposed">
            Not just a number — how much of it came from Elo alone, versus how much the added team
            stats (and, for NFL, the presumed starting QBs) moved it. Lets you judge whether the
            model&apos;s conviction rests on one signal or several agreeing.
          </Field>
          <Field term="Elo rating trend">
            Both teams&apos; last several games plotted side by side — climbing means beating
            expectations lately, flattening or dropping means the opposite.
          </Field>
          <Field term="Recent form &amp; head-to-head">
            Plain game logs: who each team just played, what happened, and every prior meeting
            between these two teams in the dataset. The number next to each opponent&apos;s name is
            <em> their</em> Elo rating going into that game — a win over a 1650-rated team says a
            lot more than a win over a 1350 one, and Elo already accounts for that when it updates
            a team&apos;s own rating; this just makes that strength-of-schedule effect visible
            instead of only baked invisibly into the final number.
          </Field>
          <Field term="Team stat trends (NFL only)">
            Total yards, turnover margin, and offensive efficiency, one point per game — the same
            numbers the NFL model actually trains on, so you can see the trend behind the diff.
          </Field>
        </dl>

        <Callout kind="tip">
          Every edge card and every collapsed &quot;flagged&quot; or &quot;no edge&quot; item in
          This Week has its own Research link — the model only recommends a small slice of each
          week&apos;s games, but every game is here to look into if you have your own angle
          (injury news, a rivalry factor, weather) the model can&apos;t see.
        </Callout>
      </Section>

      <Section id="this-week" title="Research: This Week (automated, NFL &amp; college football)">
        <p style={{ color: "var(--text-secondary)" }}>
          Pick a sport, and it does steps 1 and 2 of the big picture above for you: pulls this
          week&apos;s upcoming games and live odds automatically, runs each one through the same
          probability model as the Model page (NFL includes real team-stat features; college
          football is Elo-only — see below), and surfaces only the games worth a second look —
          sized against your current bankroll from Tracker.
        </p>

        <SubHeading>How to use it</SubHeading>
        <ol className="flex flex-col gap-1 pl-5" style={{ color: "var(--text-secondary)" }}>
          <li className="list-decimal">
            Open Research → This Week, pick NFL or college football — it loads that week&apos;s
            schedule and odds on its own.
          </li>
          <li className="list-decimal">
            Pick a stake-sizing rule (defaults to ½ Kelly) if you want something other than the
            default.
          </li>
          <li className="list-decimal">
            Read the top list: each card is a specific recommendation (team, odds, expected
            value, recommended stake).
          </li>
          <li className="list-decimal">
            Click <strong style={{ color: "var(--text-primary)" }}>Log this bet</strong> on a card
            you actually place — it carries the numbers straight into Tracker&apos;s form so you
            don&apos;t retype them.
          </li>
        </ol>

        <SubHeading>What the numbers mean</SubHeading>
        <dl className="flex flex-col gap-2">
          <Field term="Model prob. / Market implied">
            The model&apos;s win probability for the recommended side, next to what the
            sportsbook&apos;s own price implies (which already includes the book&apos;s built-in
            margin, the &quot;vig&quot;). The gap between them is where the edge comes from.
          </Field>
          <Field term="Expected value">Same meaning as Expectancy on the Edge Calculator — expected profit per $1 staked, at this specific market price.</Field>
          <Field term="Flagged games">
            Games where the model disagrees with the market by a lot get pulled out of the
            recommendation list and shown separately instead of hidden entirely. A big
            disagreement with a real sportsbook&apos;s price is much more likely to mean the
            model is missing something (an injury, a coaching change, a scheduling quirk) than
            that free money was found — so these are shown as a limitation to understand, never
            as a bet to place.
          </Field>
          <Field term="Season so far">
            Each card also shows both teams&apos; current-season points/game, yards/game, and
            turnover margin — just for your own read on the matchup. For college football this
            is pulled live from ESPN and is informational only (no historical archive exists to
            train on, so it isn&apos;t part of the pick or stake); very early in a season ESPN
            sometimes hasn&apos;t updated its own numbers yet and quietly hands back last
            season&apos;s final stats instead, which gets detected and relabeled &quot;Last season
            (final)&quot; so you&apos;re never looking at stale numbers labeled as current. For
            NFL, these numbers come from the same archive the model actually trains on — so
            what you see here is exactly what shaped the prediction, not a separate live read.
          </Field>
          <Field term="How would we have done?">
            A report card at the bottom of the page: it replays every game finished in the last 10
            days as if it had been predicted beforehand — using a model trained only on games
            before that window, so it never saw those results — then checks the pick against what
            actually happened. It&apos;s the closest thing to proof this app has: not &quot;trust
            the model,&quot; but &quot;here&apos;s exactly how it did on real, already-decided
            games,&quot; refreshed automatically as more games finish each week.
          </Field>
        </dl>

        <Callout kind="warning">
          This is still the same simplified model from the Probability Model page — no weather or
          roster news factored in beyond what&apos;s described below — reading live odds from
          sportsbooks via The Odds API and ESPN&apos;s public, unofficial API, either of which can
          change or go down without notice. Treat every recommendation here as a starting point to
          sanity-check against what you actually know about the matchup, not a guarantee.
        </Callout>
      </Section>

      <Section id="team-player" title="Research: Team &amp; Player">
        <p style={{ color: "var(--text-secondary)" }}>
          Two more Research sub-tabs, for when you want to dig into one thing rather than a
          matchup.
        </p>
        <dl className="flex flex-col gap-2">
          <Field term="Team">
            One team&apos;s own page: current Elo and rank, an independent second-opinion rating
            (SRS — margin-of-victory based, no home-field adjustment, computed entirely from final
            scores, never fed into the win-probability model), opponent-adjusted offense/defense
            rank, a rating-trend chart, recent form, and every upcoming game with the model&apos;s
            read on it. Tap the star next to the team name to pin it to Home.
          </Field>
          <Field term="Player">
            Search any player who has appeared in a box score — not just the ones with a live prop
            edge today. Shows season averages, the model&apos;s own projection, every book&apos;s
            current line, a hit-rate table (green/yellow/red, same color scale Outlier.bet uses) at
            last-5/last-10/season splits, a bar chart of recent games against the line, and a
            current streak badge. A player who only shows up as a defensive/tackle leader gets their
            raw game log instead — tackles aren&apos;t modeled yet, so there&apos;s no fake
            projection for them. Star a player here too, to pin them to Home.
          </Field>
        </dl>
      </Section>

      <Section id="games-rankings" title="Research: Games &amp; Rankings">
        <dl className="flex flex-col gap-2">
          <Field term="Games">
            The full schedule — not just today&apos;s picks. &quot;This Season&quot; shows every
            game played or upcoming, most current first; &quot;History&quot; shows every completed
            game from before this season, most recent first. Filter to one team, then tap any
            matchup to open it in Research.
          </Field>
          <Field term="Rankings">
            Every team, ranked by current Elo, sortable by any column — Δ Season (how far a
            team&apos;s rating has moved since their first game this year), SRS (the same
            second-opinion rating from the Team page), record, PPG, opponent-adjusted offense/
            defense, and (where available) yards/game, turnover margin, and EPA/game. A link at the
            bottom leads to opponent-adjusted QB Rankings, the same method applied to starting
            quarterbacks instead of teams.
          </Field>
        </dl>
      </Section>

      <Section id="props" title="Research: Props">
        <p style={{ color: "var(--text-secondary)" }}>
          Player prop edges, run through the exact same de-vig + trust-guardrail pipeline as
          moneyline picks — a real model-vs-market edge, not just a hit-rate count. Projects each
          player&apos;s passing/rushing/receiving yards from their own walk-forward season-to-date
          average (never using games not yet played), then checks that projection against every
          book&apos;s posted line for a real cover probability — using the actual historical
          residual distribution for that stat category, not a bell-curve assumption, so a
          right-skewed stat (a few huge games pulling the average up) doesn&apos;t quietly bias the
          over/under split the way a Normal-distribution model would.
        </p>
        <Callout kind="warning">
          This uses a plain season-to-date average, not an opponent-adjusted projection (that&apos;s
          a planned refinement) — validated separately per category on real history, and rushing,
          receiving, and passing all beat a naive league-average baseline by very different margins.
          Weight a passing or receiving edge with more caution than a rushing one. Receptions,
          touchdowns, and anytime-TD props aren&apos;t modeled yet — they need a different
          (count-based) approach than yardage does.
        </Callout>
      </Section>

      <Section id="trends" title="Trends">
        <p style={{ color: "var(--text-secondary)" }}>
          Situational ATS/O-U trends — deliberately different from a typical trend site: every
          result is measured against the real closing line (not a flat 50%, which lets &quot;good
          teams cover more&quot; masquerade as a real situational edge), and every trend shows its
          sample size instead of hiding it. Five sub-tabs:
        </p>
        <dl className="flex flex-col gap-2">
          <Field term="Trusted Trends">
            A curated list (favorite/underdog splits, division games, rest, weather) — each card
            shows Record, ROI%, cover/over rate, Units, current Streak, Last 10, Games, and Years,
            plus a cumulative-units chart. ROI/Units assume a flat 1-unit bet at standard -110 on
            every qualifying game (there&apos;s no historical per-game price archive to do
            better) — a disclosed approximation, not hidden in fine print. A trend needs at least 30
            decided games before it&apos;s marked <strong style={{ color: "var(--text-primary)" }}>trusted</strong>{" "}
            (a green border); most curated situations, run over their FULL history rather than
            cherry-picked, actually show a small negative ROI once real vig is counted — that&apos;s
            the honest, well-known truth that most &quot;trends&quot; don&apos;t beat the vig, not a
            bug.
          </Field>
          <Field term="Team Trends">
            Pick a team, and every angle worth checking against them (home/away, favorite/underdog,
            all four combinations, division games, rest) runs at once — the same math as Build Your
            Own, just pre-scoped to one team.
          </Field>
          <Field term="Today">
            Every team playing in a game with a posted line right now, matched to the curated trend
            for their exact home/away + favorite/underdog spot — so you can see what applies before
            kickoff without rebuilding it yourself. Needs the live-odds feed to be populated; shows
            nothing if it isn&apos;t.
          </Field>
          <Field term="Build Your Own">
            Combine your own filters (team, role, location, division game, and — NFL only — rest and
            weather) into a custom trend. Every combination still runs through the same 30-game
            trust gate and ROI/units math as the curated list, so a thin custom slice reads as
            &quot;small sample,&quot; not a false edge — the usual trap with unlimited-filter trend
            builders, closed by construction instead of a disclaimer.
          </Field>
          <Field term="My Trends">
            Tap the star on any trend card (anywhere in Trends) to save it here — a personal running
            list, recomputed live every time you open it, not a frozen snapshot. Saved per browser,
            not shared with anyone else yet.
          </Field>
        </dl>
      </Section>

      <Section id="calculator" title="Tracker: Edge Calculator">
        <p style={{ color: "var(--text-secondary)" }}>
          Answers one question: <em>given this probability and these odds, is there really an
          edge, and if so, how much should I stake?</em> This is the tool to open every single
          time before placing a bet, for anything the rest of the app doesn&apos;t already check
          for you — a manual line, a different sport, a hypothetical.
        </p>

        <SubHeading>What you enter</SubHeading>
        <dl className="flex flex-col gap-2">
          <Field term="Win probability (p)">
            Your honest estimate of how likely this bet is to win — not the odds, your own belief.
            If you&apos;re not confident in a precise number, err toward a more conservative
            (lower) estimate; overestimating p is the single most common way Kelly sizing gets
            people in trouble.
          </Field>
          <Field term="Net odds (b)">
            How many units you win per unit staked if you&apos;re right. Even money is b = 1.
            Standard -110 odds (bet $110 to win $100) is b ≈ 0.909. For American odds:
            positive odds like +150 → b = 1.50; negative odds like -150 → b = 100/150 ≈ 0.667.
          </Field>
          <Field term="Bankroll">The total dollars you&apos;re managing this betting strategy with.</Field>
          <Field term="Stake sizing">
            Full / ½ / ¼ Kelly — how aggressively to size relative to the mathematically
            &quot;optimal&quot; full-Kelly stake. Defaults to ½.
          </Field>
        </dl>

        <SubHeading>What the numbers mean</SubHeading>
        <dl className="flex flex-col gap-2">
          <Field term="Expectancy">
            Expected profit per $1 staked. Positive means the bet is profitable on average if you
            could repeat it many times; zero or negative means there&apos;s no real edge.
          </Field>
          <Field term="Std. dev">
            How much a single bet&apos;s outcome swings around that average — the volatility
            you&apos;re taking on for this expectancy.
          </Field>
          <Field term="Kelly fraction (f*)">
            The mathematically growth-optimal fraction of your bankroll to stake, assuming your
            probability estimate is exactly right (it never is — that&apos;s why fractional Kelly
            exists).
          </Field>
          <Field term="Recommended stake">
            f* × your chosen fraction × bankroll, in dollars. This is the number you actually bet.
          </Field>
          <Field term="The chart">
            Shows how your bankroll&apos;s long-run growth rate changes as you stake more or less
            of it. It peaks at the Kelly point and then <em>falls</em> — betting more than full
            Kelly makes things worse, not better, and betting everything (100%) guarantees
            eventual ruin.
          </Field>
        </dl>

        <SubHeading>Step by step</SubHeading>
        <ol className="flex flex-col gap-1 pl-5" style={{ color: "var(--text-secondary)" }}>
          <li className="list-decimal">Enter your probability estimate and the odds being offered.</li>
          <li className="list-decimal">Enter your current bankroll.</li>
          <li className="list-decimal">
            Check the top of the page — if it says &quot;no edge, do not bet,&quot; stop here regardless
            of how good the bet feels.
          </li>
          <li className="list-decimal">
            If there is an edge, read off the recommended stake at ½-Kelly (the default) and bet
            that amount.
          </li>
        </ol>

        <Callout kind="warning">
          A &quot;55% edge&quot; that&apos;s actually 50.5% will still get sized aggressively by full
          Kelly — the formula has no idea your probability estimate might be wrong. That&apos;s the
          entire reason to default to fractional Kelly rather than full.
        </Callout>
      </Section>

      <Section id="simulator" title="Tracker: Risk of Ruin">
        <p style={{ color: "var(--text-secondary)" }}>
          Answers: <em>if I keep betting this way for a long time, what actually happens to my
          bankroll — and how does that differ from what the &quot;average&quot; outcome makes it look
          like?</em> Use this occasionally to sanity-check a sizing habit, not before every bet.
        </p>

        <SubHeading>What you enter</SubHeading>
        <dl className="flex flex-col gap-2">
          <Field term="Win probability / odds">The typical edge you expect to find repeatedly.</Field>
          <Field term="Bets per bettor (M)">How many sequential bets to simulate — e.g. a season&apos;s worth.</Field>
          <Field term="Simulated bettors (N)">
            How many independent, parallel copies of &quot;you&quot; to simulate. More bettors = a
            smoother, more reliable ruin-rate estimate.
          </Field>
        </dl>

        <SubHeading>What the numbers mean</SubHeading>
        <dl className="flex flex-col gap-2">
          <Field term="Ruin rate">
            The % of simulated bettors whose bankroll ever collapsed to ≤1% of where they started.
          </Field>
          <Field term="Ensemble average vs. median">
            The average is dragged upward by a few enormously lucky paths — it is <em>not</em>{" "}
            what a typical bettor experiences. The median is the typical single path. The
            &quot;avg ÷ median&quot; stat shows exactly how misleading the average is; it&apos;s
            usually well above 1×.
          </Field>
          <Field term="The fan chart">
            Faint lines are individual simulated bankrolls (log scale, so both huge gains and
            near-ruin are visible on the same chart). The orange line is the average; the blue
            line is the median. The gap between them <em>is</em> the lesson.
          </Field>
        </dl>

        <SubHeading>Step by step</SubHeading>
        <ol className="flex flex-col gap-1 pl-5" style={{ color: "var(--text-secondary)" }}>
          <li className="list-decimal">Set p/b to match the kind of edge you typically find.</li>
          <li className="list-decimal">
            Click through Full Kelly → ½ Kelly → Flat → 2× Kelly and compare the ruin-rate bars at
            the bottom.
          </li>
          <li className="list-decimal">
            Pick the sizing rule with a ruin rate you&apos;re actually comfortable with — not just
            the one with the highest average outcome.
          </li>
        </ol>

        <Callout kind="tip">
          If 2× Kelly&apos;s ruin rate looks shocking compared to full Kelly&apos;s, that&apos;s
          intentional — overbetting even a real edge is one of the fastest ways to go broke, and
          this chart is the clearest way to see why.
        </Callout>
      </Section>

      <Section id="tracker" title="Tracker: Bets &amp; CLV">
        <p style={{ color: "var(--text-secondary)" }}>
          Your actual betting log. Answers: <em>am I really making money, and if not, is it my
          picks or my sizing that&apos;s the problem?</em>
        </p>

        <SubHeading>How to use it</SubHeading>
        <ol className="flex flex-col gap-1 pl-5" style={{ color: "var(--text-secondary)" }}>
          <li className="list-decimal">Set your starting bankroll once, at the top.</li>
          <li className="list-decimal">
            Every time you place a real bet, log it: description, the p you used, the odds, and
            your actual stake. It starts as &quot;pending.&quot;
          </li>
          <li className="list-decimal">
            Once the game/event resolves, click Win or Loss on that row to settle it — or wait, since
            a bet logged from a This Week/Research/Trends card carries enough structured data to
            auto-settle itself against the final score the next time you open this page.
          </li>
          <li className="list-decimal">
            Watch the stats and chart update — that&apos;s your real track record, building up
            over time.
          </li>
        </ol>

        <SubHeading>What the numbers mean</SubHeading>
        <dl className="flex flex-col gap-2">
          <Field term="Current bankroll / Total P&L">Where you actually stand right now, in dollars.</Field>
          <Field term="Win rate">% of settled bets you&apos;ve won (pushes don&apos;t count against you).</Field>
          <Field term="Current / max drawdown">
            How far below your peak bankroll you are right now, and the worst it&apos;s ever been.
            Large drawdowns are normal even with a real edge — that&apos;s the volatility from
            Risk of Ruin showing up in real life.
          </Field>
          <Field term="Realized vs. theoretical (the chart)">
            &quot;Realized&quot; is what actually happened with your real stakes. &quot;Theoretical&quot;
            replays the exact same bets and outcomes, but sized at recommended fractional-Kelly
            instead. If realized tracks noticeably <em>below</em> theoretical, your picks are fine
            but your sizing is costing you money — bet closer to the recommended amount. If
            it&apos;s <em>above</em>, you&apos;ve been sizing more aggressively than recommended,
            which means better luck so far but more risk than the model would advise.
          </Field>
          <Field term="Closing line value (CLV)">
            Once a logged bet&apos;s game reaches kickoff, shows whether the price you actually got
            beat the closing line — the standard skill signal sharp bettors track independent of
            whether any individual bet won, since a good price beaten by bad luck is still a good
            decision.
          </Field>
        </dl>

        <Callout kind="warning">
          This data lives only in this browser&apos;s local storage — it is not backed up or
          synced anywhere. Clearing your browser data or switching devices/browsers loses it.
        </Callout>
      </Section>

      <Section id="model" title="Guide: Probability Model">
        <p style={{ color: "var(--text-secondary)" }}>
          Where the probability in step 1 can come from instead of a gut estimate, for NFL or
          college football specifically. It trains a small, transparent model on real historical
          games and is upfront about how much to trust it. Lives here in the Guide rather than its
          own top-level nav item, since it&apos;s methodology, not a tool you visit weekly.
        </p>

        <SubHeading>How to read it</SubHeading>
        <dl className="flex flex-col gap-2">
          <Field term="Dataset">Pick NFL or college football. Everything below recomputes for that sport.</Field>
          <Field term="Elo K-factor / home advantage">
            Tuning knobs for the underlying team-strength ratings. Higher K-factor makes ratings
            react faster to recent results; you can usually leave these at their defaults.
          </Field>
          <Field term="Season regression">
            Pulls every team&apos;s rating partway back toward average the first time it plays in a
            new season, to account for roster turnover between seasons — especially relevant for
            college football, where rosters change far more than the pros. Defaults to 35%, which
            measured best overall on real history. It is a general accuracy tune, not specifically
            an opening-week fix — the very earliest games of a season actually calibrate a touch
            worse as this goes up, even though the season overall gets more accurate.
          </Field>
          <Field term="&quot;vs. Elo-only&quot; (NFL only)">
            On NFL, the model also factors in each team&apos;s season-to-date total yards,
            turnover margin, and offensive efficiency — using only games already played before the
            one being predicted, never a peek ahead. This tile trains the same model with those
            extra stats turned off and compares the two head-to-head, so you can see the real
            effect instead of just trusting it helps. College football doesn&apos;t have a public
            per-game stats archive like this, so its model still runs on Elo alone.
          </Field>
          <Field term="Brier score">
            The model&apos;s calibration grade — lower is better, 0 is perfect. What matters more
            than the raw number is the comparison right next to it: does it actually beat a naive
            &quot;always guess the average home-win rate&quot; baseline? If not, the model isn&apos;t
            adding value.
          </Field>
          <Field term="Reliability diagram">
            The single most important chart on this page. Each dot groups games by the model&apos;s
            predicted probability and plots the probability it actually assigned against how often
            that side actually won. Dots sitting on the dashed diagonal mean the model is honest —
            when it says 70%, that side wins about 70% of the time. Dots <em>below</em> the
            diagonal mean the model is overconfident, which is the dangerous direction for Kelly
            sizing.
          </Field>
          <Field term="Backtest">
            Replays only the held-out games (the ones the model never trained on) as bets at
            standard -110 odds, comparing flat vs. full-Kelly vs. half-Kelly sizing.
          </Field>
          <Field term="Per-bet growth rate">
            The number to actually compare across strategies — not the raw final-bankroll dollar
            figure, which can compound into meaningless, astronomically large numbers over
            1,000+ backtested bets (see the warning below).
          </Field>
        </dl>

        <SubHeading>Step by step</SubHeading>
        <ol className="flex flex-col gap-1 pl-5" style={{ color: "var(--text-secondary)" }}>
          <li className="list-decimal">Pick a sport, and check the Brier score beats the naive baseline.</li>
          <li className="list-decimal">
            Look at the reliability diagram — if dots track the diagonal reasonably well, the
            model&apos;s probabilities are trustworthy enough to use as a starting point.
          </li>
          <li className="list-decimal">
            Compare per-bet growth rate across flat / full-Kelly / half-Kelly in the backtest to
            get a feel for how sizing discipline would have mattered historically.
          </li>
          <li className="list-decimal">
            For a real upcoming game, take the model&apos;s implied probability as a starting
            point — not gospel — and carry it into the Edge Calculator, ideally shaded a little
            toward 50% to account for the model&apos;s own uncertainty.
          </li>
        </ol>

        <Callout kind="warning">
          The backtest&apos;s full-Kelly dollar figure can look absurd (far beyond anything real).
          That&apos;s expected — it&apos;s genuine Kelly math compounding a sustained edge across
          1,000+ consecutive bets, assuming a market that would let you keep re-betting an
          ever-growing bankroll at unchanged odds for over a decade, which no sportsbook would
          actually allow. Treat it as an illustration of how powerful (and dangerous)
          uncapped compounding is, not a real projection — and use the per-bet growth rate instead.
        </Callout>
      </Section>

      <Section id="key-ideas" title="Key ideas to remember">
        <ul className="flex flex-col gap-2 pl-5" style={{ color: "var(--text-secondary)" }}>
          <li className="list-disc">
            <strong style={{ color: "var(--text-primary)" }}>No edge, no bet</strong> — always
            check expectancy before staking anything.
          </li>
          <li className="list-disc">
            <strong style={{ color: "var(--text-primary)" }}>The average is not what you get</strong>{" "}
            — your own single path looks like the median, not the ensemble average. Judge sizing
            rules by ruin rate and the median outcome, not the average.
          </li>
          <li className="list-disc">
            <strong style={{ color: "var(--text-primary)" }}>Fractional Kelly is the default, not a compromise</strong>{" "}
            — your probability estimate always has error, and Kelly has no idea how much.
          </li>
          <li className="list-disc">
            <strong style={{ color: "var(--text-primary)" }}>A calibrated model beats a confident one</strong>{" "}
            — an overconfident model is more dangerous to size bets off of than no model at all.
          </li>
          <li className="list-disc">
            <strong style={{ color: "var(--text-primary)" }}>Sample size before conclusions</strong>{" "}
            — a trend with 100% win rate over 12 games and a trend with 55% over 500 games are not
            equally trustworthy; Trends flags this everywhere on purpose.
          </li>
          <li className="list-disc">
            <strong style={{ color: "var(--text-primary)" }}>Track sizing and picking separately</strong>{" "}
            — Tracker&apos;s realized-vs-theoretical comparison tells you which one is actually
            costing you money.
          </li>
        </ul>
      </Section>
    </div>
  );
}
