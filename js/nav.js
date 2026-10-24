// Muestra u oculta el menú según haya sesión. Se carga en <head> para evitar parpadeos.
window.lanzecSetLogged = function (on) { document.documentElement.classList.toggle('logged', !!on); };
(function () {
  var on = false;
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (/^sb-.*-auth-token$/.test(k) && localStorage.getItem(k)) { on = true; break; }
    }
  } catch (e) {}
  window.lanzecSetLogged(on);
})();
