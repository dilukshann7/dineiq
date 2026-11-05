# Automatic table layouts

Starting the admin camera discovers tables and visible chairs automatically. Three
consistent suggestions, sampled one second apart, save the initial layout and start
monitoring. Onboarding advances through the camera and table steps automatically.
Staff setup and the final monitoring check remain part of onboarding.

While monitoring, segmented new tables with visible seats are added after at least
three consistent observations spanning two seconds. Existing table names, IDs, and
seat IDs are retained when positions can be matched. Position updates require three
consistent observations spanning at least one second and are saved automatically.

A table is removed only after at least five observations spanning ten seconds show
that its surface has disappeared and the visible pixels differ from its saved
appearance. A missed detection alone does not remove a table. Obstructed surfaces,
uncertain camera alignment, slow processing, and observation gaps interrupt this
confirmation. Removed tables disappear from the current layout and snapshots; their
active staff alerts and visits end, while historical events remain available.

Confirmation tolerates up to five seconds between observations, matching the
capture watchdog and dashboard freshness window. This accommodates serialized
inference without restarting confirmation on every frame. Longer gaps still reset
the pending evidence. Frames that take more than five seconds to process are rejected.

When the camera view or OBS scene changes, the system automatically learns a new
camera reference and table setup after five consistent frames spanning at least
three seconds. The new background must match across frames, and visible tables and
seats must match consistently. The view must settle before it can be saved. A new
view starts new table identities and ends staff episodes for tables from the previous
view, so unrelated scenes do not share occupancy or service timers.

A stable empty view requires at least ten seconds and visible changed pixels in
every old table region before clearing the old setup. Missed detections alone, blank
OBS transitions, obstructed surfaces, and a moving camera cannot clear the setup.
Automatic setup waits for visible chairs rather than inventing seat capacity.
Hidden chairs, ambiguous matches, and insufficient background detail can require a
clearer view or an optional manual correction.

Use **Edit tables manually** for optional corrections. Saving those corrections
resumes monitoring. Explicitly stopping monitoring keeps it stopped until the user
starts it again or restarts the camera.
Interrupted monitoring retries automatically after two seconds while the camera
remains live. An explicit stop cancels that retry.

No database migration is needed. Automatic changes use the existing layout position
version and commit regions, table states, and staff episode cleanup together.
