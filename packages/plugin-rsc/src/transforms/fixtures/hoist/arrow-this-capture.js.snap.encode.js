// Verifies that arrow functions with lexical `this` are hoisted with
// `.bind(this)` so the converted regular function receives the correct
// `this` value from the enclosing scope.
class Counter {
  value = 0

  method() {
    const action = /* #__PURE__ */ $$register($$hoist_0_action, "<id>", "$$hoist_0_action").bind(this)
    return action
  }
}

;export async function $$hoist_0_action() {
      'use server'
      return this.value
    };
/* #__PURE__ */ Object.defineProperty($$hoist_0_action, "name", { value: "action" });
