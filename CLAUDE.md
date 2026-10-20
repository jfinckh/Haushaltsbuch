<!-- change-map:start -->
## Change map

This project uses change-map. When to use change-map: use the change-map workflow for every new feature, change to a feature, or refactoring. Skip it only for a change that stays inside one unit and adds no source file, dependency, table, package, environment key or export: typos, small bug fixes, tests, docs.

The workflow (the `change-map` skill has the steps): plan as usual, add the change-manifest to the implementation plan, run the check, and get the sign-off items approved before building anything. Nothing is built until the plan is approved; afterwards, finalize with the same skill. `/change-map` shows the status, `/change-map check` audits the architecture.
<!-- change-map:end -->
