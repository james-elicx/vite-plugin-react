// Arrow functions inherit `arguments` from the enclosing non-arrow function.
// The hoist transform rewrites `arguments` references to a bound parameter
// so the hoisted regular function doesn't shadow the original `arguments`.
function handler() {
  const action = /* #__PURE__ */ $$register($$hoist_0_action, "<id>", "$$hoist_0_action").bind(null, __enc([arguments]))
  return action
}

;export async function $$hoist_0_action($$hoist_encoded) {
    const [$$hoist_arguments] = __dec($$hoist_encoded);
'use server'
    return $$hoist_arguments.length
  };
/* #__PURE__ */ Object.defineProperty($$hoist_0_action, "name", { value: "action" });
