/* Applies the saved look before the page paints (kept separate: the CSP forbids inline scripts).
   Light unless the person chose dark; the system setting is not followed. */
(function () {
  var t = "light";
  try { if (localStorage.getItem("solo:theme") === "dark") t = "dark"; } catch (e) {}
  var root = document.documentElement;
  root.setAttribute("data-theme", t);
  var metas = document.querySelectorAll('meta[name="theme-color"]');
  for (var i = 0; i < metas.length; i++) { metas[i].removeAttribute("media"); metas[i].setAttribute("content", t === "dark" ? "#16131C" : "#FBF6EC"); }
})();
