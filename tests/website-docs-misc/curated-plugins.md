# Curated plugin browser (17, partial)

Setup: capable runtime exposing vertical collection, or intercepted
`node scripts/test-approved-plugins.cjs`. Open Skills → Curated plugin collection;
Read curated plugins. Expect one plugin/list with explicit vertical-only source
and forceRefetch:false, no default/local catalog, installed-list, sync, install,
uninstall or Marketplace mutation. Expand a returned item: actual native source,
advertised/local versions, installed/enabled values, developer/description. Missing
values stay unavailable/unknown. Filter returned data, show more in bounded groups.
Empty may mean this runtime/account/feature configuration exposes no vertical
collection; do not enable flags. Check errors/connection changes/delayed responses,
both themes/all sizes. Cleanup: close fixture; no remote resources changed.

Performance: zero startup requests/listeners or polling. One explicit catalog
read, max 32 marketplaces/400 plugins, 40 initially rendered, bounded descriptions,
10 warnings. Local filtering over returned bounded data, no per-keystroke RPCs or
remote images. Native response size is not client-controlled. Live NOT RUN.
