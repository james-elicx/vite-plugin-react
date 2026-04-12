// Verifies that default parameter `x = y` captures outer `y`, not the
// body's `var y` which is spec-invisible to default initializers.
//
// The encode path decodes via a destructuring param default so that
// bound vars are available before default param initializers run.
function Component() {
  const y = 'from outer'

  const action = /* #__PURE__ */ $$register($$hoist_0_action, "<id>", "$$hoist_0_action").bind(null, y);

  return action
}

;export async function $$hoist_0_action(y, x = y) {
    'use server'
    var y = 'body shadow'
    return x
  };
/* #__PURE__ */ Object.defineProperty($$hoist_0_action, "name", { value: "action" });
