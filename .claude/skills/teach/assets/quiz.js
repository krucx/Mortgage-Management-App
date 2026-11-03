// Shared quiz + reveal widgets.
// Quiz:   <div class="quiz" data-answer="2"><p class="q">…</p>
//           <button class="opt">…</button> ×N  <div class="why">…</div></div>
//         data-answer is the 0-based index of the right option.
// Reveal: <div class="reveal"><button class="show">…</button><div class="reveal-body">…</div></div>
// A <span class="score"></span> anywhere shows "n of m right".
(function () {
  const quizzes = [...document.querySelectorAll(".quiz")];
  const score = () => {
    const done = quizzes.filter(q => q.classList.contains("answered"));
    const right = done.filter(q => q.dataset.firstTry === "right").length;
    document.querySelectorAll(".score").forEach(s =>
      s.textContent = `${right} of ${quizzes.length} right first time` + (done.length < quizzes.length ? ` · ${quizzes.length - done.length} to go` : ""));
  };
  quizzes.forEach(quiz => {
    const answer = Number(quiz.dataset.answer);
    const opts = [...quiz.querySelectorAll("button.opt")];
    opts.forEach((btn, i) => btn.addEventListener("click", () => {
      if (quiz.classList.contains("answered")) return;
      if (!quiz.dataset.firstTry) quiz.dataset.firstTry = i === answer ? "right" : "wrong";
      if (i === answer) {
        btn.classList.add("right");
        quiz.classList.add("answered");
        opts.forEach(o => (o.disabled = true));
      } else {
        btn.classList.add("wrong");
        btn.disabled = true;
      }
      score();
    }));
  });
  document.querySelectorAll(".reveal button.show").forEach(b =>
    b.addEventListener("click", () => b.closest(".reveal").classList.add("open")));
  score();
})();
