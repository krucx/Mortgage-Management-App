// Renders line-numbered code snippets.
// Markup: <figure class="snippet"><figcaption>…</figcaption><pre data-file="path/from/repo/root"><code>
//   260  real code line
//   ⋮    … a note about what was skipped …
//   268  another line  ◀        (a trailing ◀ highlights the line)
// </code></pre></figure>
// Each line starts with its real source line number (or ⋮ for skipped lines).
// The numbers become a gutter that isn't selected when the reader copies the code.
(function () {
  document.querySelectorAll("figure.snippet pre code").forEach(code => {
    const lines = code.innerHTML.replace(/\n$/, "").split("\n");
    code.innerHTML = lines.map(line => {
      const m = line.match(/^\s*(\d+|⋮)(?: {1,2}|$)(.*)$/);
      if (!m) return `<span class="ln"><span class="no"></span>${line}</span>`;
      let [, no, rest] = m;
      const hl = /\s+◀\s*$/.test(rest);
      if (hl) rest = rest.replace(/\s+◀\s*$/, "");
      const cls = ["ln", no === "⋮" ? "gap" : "", hl ? "hl" : ""].filter(Boolean).join(" ");
      return `<span class="${cls}"><span class="no">${no}</span>${rest}</span>`;
    }).join("");
  });
})();
