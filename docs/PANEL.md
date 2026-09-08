# The panel — what to fix and what to add

Written 2026-09-08 after reading the app rather than looking at screenshots.
The foundation is fine: design tokens, a real card/stat/pill vocabulary,
server components, server actions with `useActionState`, search on the pages
that need it. What follows is ordered by whether the panel is currently
*wrong*, then by what would save the most time.

---

## A. Where the panel is currently wrong

### A1. "Live voice" is not live

`revalidate = 0` means the page is fresh **when you navigate to it** and never
again. Someone watching that page to see a situation develop is watching a
photograph. This is the only page whose name makes a promise the code does not
keep.

Two ways out, cheapest first:

- **Poll**: a client component calling `router.refresh()` every 5 s while the
  tab is visible. Ten lines, no new infrastructure, and the Page Visibility API
  keeps it from running in a background tab.
- **Stream**: an SSE route that subscribes to the bot's loopback API and pushes
  voice state. Better, and the bot already has the events — but it is a real
  piece of plumbing and the polling version is indistinguishable at 139
  members.

Take the poll. Revisit if the server triples.

### A2. There are no error or loading boundaries anywhere

No `error.tsx`, no `loading.tsx`, no `not-found.tsx` in the entire app. That
means:

- Any thrown error in a server component shows Next's default error page — a
  stack trace in dev, a bare "something went wrong" in production, and no way
  back except the browser's back button.
- Every navigation is a blank pause with no skeleton, because there is nothing
  to show while the server component resolves.

Per-route `loading.tsx` skeletons shaped like the page they replace, and one
`error.tsx` per group with a retry button and a link home.

### A3. Logs stop at 150 rows

`.limit(150)` with no pagination. The filters are good, but once a filter
matches more than 150 events you silently see only the newest ones — with no
indication that the rest exist. A cursor on `logEvents.id` and a "load older"
button, plus a count so the truncation is visible.

### A4. Result banners are invisible to screen readers

`useActionState` results render as a plain `<div>`. Without `aria-live`,
someone using a screen reader gets no announcement that their action
succeeded or failed — the page simply does not change as far as they can tell.
One attribute fixes it.

---

## B. Make it look like AION

The bot now has a strong identity — ink black, the blue rift, the lockup. The
panel shares a dark theme with it and nothing else. Same server, two visual
languages.

### B1. Carry the identity through

The login page is the obvious place for the rift hero. The dashboard header
should carry the lockup. And the accent language should match the banners
exactly: **blue for voice, yellow for chat, gold for staff, red for
moderation** — so a colour means the same thing whether you see it in Discord
or in the panel.

### B2. Show the actual artwork

The panel configures leaderboards and announcements, then describes them in
words. It could render the real thing:

- The leaderboard settings page can call the same banner renderer and show the
  PNG the server will actually post.
- The announce composer can preview the Components V2 card as Discord will
  draw it, instead of a plain textarea.

This is the difference between configuring a thing and seeing the thing.

### B3. Avatars wherever there is a name

The panel shows member names as text in most tables. The Discord cards all
show avatars now. Faces are how people recognise each other.

---

## C. Speed for the people who live in it

### C1. A command palette

⌘K to jump to a member, run an action, or open a section. For a tool an admin
opens twenty times a day, this is the single biggest time saver on the list,
and it is now a baseline expectation rather than a flourish.

### C2. Toasts with undo, instead of confirms

Today destructive actions use a `confirmDanger` state — a second click before
anything happens. That is right for a guild ban and wrong for everything else:
it taxes every action to protect the rare one.

Invert it for the reversible ones. Do it immediately, show
`Role removed · Undo`, and keep the two-step confirm only where there is
genuinely no undo.

### C3. Bulk actions

Select several members, add a role once. Right now a role change is one member
at a time, which is fine for one and miserable for twenty.

---

## D. Information design

### D1. The overview should be an inbox, not a scoreboard

It currently shows stats — member count, messages, voice hours. Those are the
answer to "how is the server doing", which is a question you ask monthly. The
question an admin opens the panel with is **"what needs me right now?"**

Pending verifications, punishments expiring in the next hour, unresolved
AutoMod hits, watchdog alerts, members whose warn count just crossed the
threshold. Stats belong below that, not above it.

### D2. An activity heatmap

Day × hour, from `activityDaily`. It answers "when is this server actually
awake", which is exactly what you need before scheduling a Mafia night. The
data is already there.

### D3. A member timeline

The member page shows sections. It could show one column in time order: joined,
verified, warned, muted, unmuted, nickname changed. A moderator deciding what
to do next reads a story faster than a set of tables.

---

## E. Polish

- **Mobile.** The sidebar is desktop-shaped. A drawer or a bottom bar for
  phones — admins moderate from their phone more than from a desk.
- **Chart hover.** `Chart.tsx` renders static SVG with no values on hover.
- **Density toggle.** Comfortable and compact for the tables.
- **Role-adaptive views.** A section Global does not need pages they cannot
  act on. Showing everyone everything makes the tool feel bigger than it is.

---

## Suggested order

1. **A1 and A2** — the panel currently misleads and has no error floor. Half a
   day together.
2. **C1, the command palette** — the biggest daily time saving.
3. **B1 and B2** — make it feel like the same product as the bot.
4. **D1, the overview rewrite** — changes what the panel is *for*.

Everything else is genuinely optional.
