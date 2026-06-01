import { UnirendHead } from 'unirend/client';

export function SimulateDataloaderError() {
  return (
    <>
      <UnirendHead>
        <title>Simulate Dataloader Throw</title>
      </UnirendHead>
      <main>
        <h1>Simulate Dataloader Throw</h1>
        <p>If you see this page, the demo loader did not throw as expected.</p>
      </main>
    </>
  );
}
