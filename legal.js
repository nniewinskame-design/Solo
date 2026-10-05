/* Standalone legal pages: the back arrow returns to Solo. */
(function () {
  var b = document.getElementById("back");
  if (b) b.addEventListener("click", function (e) {
    var fromApp = document.referrer && document.referrer.indexOf(location.origin) === 0;
    if (fromApp && history.length > 1) { e.preventDefault(); history.back(); }
  });
})();
