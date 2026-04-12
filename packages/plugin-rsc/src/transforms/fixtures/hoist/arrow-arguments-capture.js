// Arrow functions inherit `arguments` from the enclosing non-arrow function.
// The hoist transform rewrites `arguments` references to a bound parameter
// so the hoisted regular function doesn't shadow the original `arguments`.
function handler() {
  const action = async () => {
    'use server'
    return arguments.length
  }
  return action
}
