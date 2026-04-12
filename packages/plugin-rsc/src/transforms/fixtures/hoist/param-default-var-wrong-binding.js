// Verifies that default parameter `x = y` captures outer `y`, not the
// body's `var y` which is spec-invisible to default initializers.
//
// The encode path decodes via a destructuring param default so that
// bound vars are available before default param initializers run.
function Component() {
  const y = 'from outer'

  async function action(x = y) {
    'use server'
    var y = 'body shadow'
    return x
  }

  return action
}
