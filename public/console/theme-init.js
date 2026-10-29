(() => {
  // console/shared/theme-init.js
  (function() {
    var theme;
    try {
      var saved = localStorage.getItem("qq-console-theme");
      theme = saved === "dark" || saved === "light" ? saved : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch (error) {
      theme = "light";
    }
    document.documentElement.dataset.theme = theme;
  })();
})();
