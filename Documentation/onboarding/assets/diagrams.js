// Renders every <pre class="mermaid"> with the bundled Mermaid, in the course's colours.
// Works offline and from file:// (no network, no ES modules).
// Load after Mermaid:
//   <script src="../assets/mermaid.min.js"></script>
//   <script src="../assets/diagrams.js"></script>
// mermaid.min.js is Mermaid 11 (MIT licence), vendored so the course needs no internet.
(function () {
  if (!window.mermaid) return; // Mermaid missing: the diagram source stays visible as text.
  mermaid.initialize({
    startOnLoad: false,
    theme: "base",
    themeVariables: {
      fontFamily: '"Iowan Old Style", Palatino, Georgia, serif',
      fontSize: "15px",
      primaryColor: "#fffff8",
      primaryBorderColor: "#1d1d1b",
      primaryTextColor: "#1d1d1b",
      lineColor: "#6b6a66",
      secondaryColor: "#f4f1e8",
      tertiaryColor: "#fbeee4",
    },
    flowchart: { curve: "basis", htmlLabels: true },
  });
  mermaid.run({ querySelector: "pre.mermaid" });
})();
