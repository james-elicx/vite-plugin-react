// Per spec, default parameter initializers run in the parameter environment
// and cannot see `var` declarations from the function body.  The `y` in
// `x = y` must resolve to `outer`'s `const y`, not `inner`'s `var y`.
function outer() {
  const y = 'outer'
  function inner(x = y) {
    var y = 'inner'
    return x
  }
  return inner()
}
