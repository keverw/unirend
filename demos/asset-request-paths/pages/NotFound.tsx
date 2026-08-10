import { Link } from 'react-router';

export function NotFound() {
  return (
    <section>
      <h1>Normal React 404</h1>
      <p>
        This route was not a mapped static asset, so the selected app reached
        React and rendered its normal 404.
      </p>
      <Link to="/">Return to demo</Link>
    </section>
  );
}
