/* Marca la página como "con sesión" para mostrar/ocultar el menú (CSS: html.logged).
   Se carga en <head> para evitar parpadeos. app.js confirma la sesión real. */
(function () {
  function hasToken() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (/^sb-.*-auth-token$/.test(k) && localStorage.getItem(k)) return true;
      }
    } catch (e) {}
    return false;
  }
  window.lanzecSetLogged = function (on) { document.documentElement.classList.toggle('logged', !!on); };
  window.lanzecSetLogged(hasToken());
})();
