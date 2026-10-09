/* Modo claro / oscuro.
   Se carga en el <head>, sin esperar, para fijar el tema antes de pintar y evitar un
   destello del tema equivocado. La elección se recuerda en este navegador; sin
   elección, se sigue el modo del sistema operativo. */
(function () {
  var KEY = "essensa_theme";
  var root = document.documentElement;
  var media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  function stored() {
    try {
      var v = localStorage.getItem(KEY);
      return v === "dark" || v === "light" ? v : null;
    } catch (e) {
      return null;
    }
  }

  function current() {
    return stored() || (media && media.matches ? "dark" : "light");
  }

  function paint(theme, announce) {
    root.setAttribute("data-theme", theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#141311" : "#faf8f4");
    var scheme = document.querySelector('meta[name="color-scheme"]');
    if (scheme) scheme.setAttribute("content", theme);
    document.querySelectorAll("[data-theme-toggle]").forEach(function (b) {
      var dark = theme === "dark";
      b.setAttribute("aria-pressed", String(dark));
      b.setAttribute("aria-label", dark ? "Modo oscuro activado. Cambiar a modo claro" : "Modo claro activado. Cambiar a modo oscuro");
      var label = b.querySelector("[data-theme-label]");
      if (label) label.textContent = dark ? "Modo claro" : "Modo oscuro";
      var sun = b.querySelector("[data-icon-sun]");
      var moon = b.querySelector("[data-icon-moon]");
      if (sun) sun.hidden = !dark;
      if (moon) moon.hidden = dark;
    });
    if (announce) document.dispatchEvent(new CustomEvent("themechange", { detail: { theme: theme } }));
  }

  // Tema fijado antes del primer pintado.
  paint(current(), false);

  function set(theme) {
    try {
      localStorage.setItem(KEY, theme);
    } catch (e) {
      /* sin almacenamiento: el cambio vale solo para esta visita */
    }
    paint(theme, true);
  }

  window.EssensaTheme = {
    current: current,
    toggle: function () {
      set(current() === "dark" ? "light" : "dark");
    },
  };

  // Los botones existen cuando el documento ya cargó.
  document.addEventListener("DOMContentLoaded", function () {
    paint(current(), false);
    document.querySelectorAll("[data-theme-toggle]").forEach(function (b) {
      b.addEventListener("click", function () {
        window.EssensaTheme.toggle();
      });
    });
  });

  // Sin elección propia, se sigue al sistema aunque cambie mientras la página está abierta.
  if (media && media.addEventListener) {
    media.addEventListener("change", function () {
      if (!stored()) paint(current(), true);
    });
  }
})();
