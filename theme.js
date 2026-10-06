/* Applies the saved look before the page paints (kept separate: the CSP forbids inline scripts).
   Light unless the person chose dark, or "Auto" (then the system setting). */
(function () {
  var t = "light";
  try { var v = localStorage.getItem("solo:theme"); if (v === "dark" || (v === "auto" && matchMedia("(prefers-color-scheme: dark)").matches)) t = "dark"; } catch (e) {}
  var root = document.documentElement;
  root.setAttribute("data-theme", t);
  var metas = document.querySelectorAll('meta[name="theme-color"]');
  for (var i = 0; i < metas.length; i++) { metas[i].removeAttribute("media"); metas[i].setAttribute("content", t === "dark" ? "#0E0E11" : "#F7F7F9"); }
})();
