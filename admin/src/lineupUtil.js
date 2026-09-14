export function moveItem(arr, from, to) {
  if (to < 0 || to >= arr.length || from === to) return arr;
  const out = arr.slice();
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x);
  return out;
}
