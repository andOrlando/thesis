function c(s) {
  function a(s) { return s; }
  function b(a, s) {
    return a(s);
  }
  return b(a, s)
}
c(5);
c("a");
