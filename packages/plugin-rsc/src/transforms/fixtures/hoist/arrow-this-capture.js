// Verifies that arrow functions with lexical `this` are hoisted with
// `.bind(this)` so the converted regular function receives the correct
// `this` value from the enclosing scope.
class Counter {
  value = 0

  method() {
    const action = async () => {
      'use server'
      return this.value
    }
    return action
  }
}
