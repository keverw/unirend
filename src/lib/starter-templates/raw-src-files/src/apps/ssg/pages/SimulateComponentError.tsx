// During SSG build (no `window`), this component renders a static placeholder so the
// generator doesn't fail. In the browser, it throws immediately on hydration, which
// triggers the ApplicationError boundary.
export function SimulateComponentError() {
  if (typeof window !== 'undefined') {
    // eslint-disable-next-line unicorn/prefer-type-error
    throw new Error('Simulated component error');
  }

  return (
    <div className="rounded-lg border-4 border-dashed border-orange-500 p-8">
      <h1 className="mb-4 text-4xl font-bold text-gray-800 dark:text-gray-100">
        Simulate Component Error
      </h1>
      <p className="text-gray-600 dark:text-gray-400">
        This page throws a React component error in the browser to demo the{' '}
        <code>ApplicationError</code> boundary. Open it in a browser to trigger
        it. It won't throw during pre-render.
      </p>
    </div>
  );
}
