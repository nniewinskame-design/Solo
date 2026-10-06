/* Standalone legal pages: the back arrow returns to Solo. Only a page of Solo itself counts as "came from the app"
   (other sites on the same github.io address share the origin, so the origin alone is not enough). */
(function () {
  var b = document.getElementById("back");
  if (b) b.addEventListener("click", function (e) {
    var here = location.href.replace(/[?#].*$/, "").replace(/[^/]*$/, "");
    var fromApp = document.referrer && document.referrer.indexOf(here) === 0;
    if (fromApp && history.length > 1) { e.preventDefault(); history.back(); }
  });
})();
