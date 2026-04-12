// A nested function inside a default param expression has its own var scope.
// The `y` in `return y` must resolve to `g`'s own `var y`, not skip it.
function f(x = function g() { var y = 'inner'; return y }()) {
  var y = 'body'
}
