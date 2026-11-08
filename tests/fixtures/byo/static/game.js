// A tiny game: click the dot. Plain static files, no build.
const c = document.getElementById('c'), g = c.getContext('2d'), score = document.getElementById('score');
let dot = { x: 160, y: 120 }, n = 0;
function draw() { g.clearRect(0, 0, c.width, c.height); g.fillStyle = '#f5b942'; g.beginPath(); g.arc(dot.x, dot.y, 14, 0, Math.PI * 2); g.fill(); }
c.addEventListener('pointerdown', e => {
  const r = c.getBoundingClientRect(), x = (e.clientX - r.left) * c.width / r.width, y = (e.clientY - r.top) * c.height / r.height;
  if (Math.hypot(x - dot.x, y - dot.y) < 20) { n++; score.textContent = `Score: ${n}`; dot = { x: 20 + Math.random() * 280, y: 20 + Math.random() * 200 }; draw(); }
});
draw();
