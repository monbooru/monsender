// Runs in the page: injected into the active tab under activeTab, so it
// reaches nothing privileged - no storage, no api, no token. Loaded after
// scan-core.js, runs once on a user gesture and does not persist; the final
// expression is the executeScript result. Firefox cannot structured-clone the
// collected array of objects back across the content-script sandbox boundary,
// but a string always clones, so the list is serialized here and parsed by the
// caller.
JSON.stringify(self.ML.scanCore.collect(document, window));
