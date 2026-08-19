# Givash Gals — league rules

Non-obvious scoring rules, stated exactly. Kept in lockstep with `rules.js`;
change one and change the other in the same commit.

## Lowest score wins

Every head-to-head matchup is won by the **lower** adjusted score. Equal
adjusted scores are a tie, worth 0.5 in the standings.

## The +20 penalty

Each starter that scores **exactly 0** adds **20 points** to your total.
"Exactly 0" means `Math.abs(points) < 1e-9`.

One exception: **a DEF that is not on bye is exempt.** A defense scoring 0 is
a legitimate outcome under this league's settings (`pts_allow_21_27` is 0.0),
so it is not punished. A DEF whose NFL team *is* on bye is penalised like
anyone else.

Deliberate consequences:

- **Negative scores are kept.** A kicker at -1 for a missed field goal stays
  at -1. A negative is a reward here; the penalty exists to punish absent
  lineups, not good ones.
- **An empty starter slot counts as 0 and takes +20.**
- **Penalties stack.** Four zeroes is +80.

### Worked example

    QB   Burrow      18.4
    RB   Robinson     0.0   -> +20  (scored 0)
    WR   (empty)      0.0   -> +20  (empty slot)
    K    Bass        -1.0          (missed FG, kept negative)
    DEF  HOU          0.0          (exempt, HOU not on bye in week 3)
    ...  rest                76.2

    Raw       = 93.6
    Penalties = +40
    Adjusted  = 133.6

In week 8, when Houston is on bye, that same DEF takes +20 and the adjusted
score is 153.6.

## The median matchup

The league has 5 managers in 6 roster slots. The roster nobody owns is the
**ghost roster**; it is excluded from everything. Each week the real team
Sleeper pairs against the ghost plays the **league median** instead of an
opponent.

Before the league fills, more than one slot is unowned. **Every** unowned
roster is excluded, not just the lowest-numbered one, so the median is never
averaged over an empty team's score.

The median is the average of the **2nd and 3rd highest adjusted scores among
the four teams playing head-to-head** that week. The ghost and the median
team are both excluded from that pool.

    median = (2nd highest + 3rd highest) / 2

The median team **wins if its adjusted score is below the line**, loses if
above, ties if exactly equal.

### Worked example

Non-bye adjusted scores: 142.6, 118.3, 97.5, 88.1.
2nd is 118.3, 3rd is 97.5, so the line is (118.3 + 97.5) / 2 = **107.9**.
A median team at 101.2 is below the line and **wins**.

Penalties are applied *before* the median is computed. Every score in the
system is an adjusted score — there is only one kind.

## Standings

- Record is W-L-T. A tie counts 0.5.
- A median win counts exactly the same as a head-to-head win.
- Win% is `(W + 0.5 x T) / (W + L + T)`.
- Tiebreaks, in order: win%, then **lowest** adjusted points-for, then
  head-to-head. Teams none of those separate are shown with a `T-` rank.

## Scope

**There are no playoffs.** All 18 weeks are regular-season weeks and count
identically — weeks 15-18 are ordinary weeks, not a bracket. The standings
after week 18 are the final rankings; whoever finishes first has won the
league.

(Sleeper's own bracket is ignored entirely. It assumes 6 teams and
highest-score-wins, so it could not be used even if we wanted one.)

A week is scored only if Sleeper's pairings read as one of two shapes: **two
head-to-head matchups plus one team on the median** (the normal 5-manager
case), or **three straight head-to-head matchups and no median** (every slot
owned). Any other shape is reported as unresolvable and excluded from the
standings entirely. Nothing is guessed.
