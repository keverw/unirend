import { UnirendHead } from 'unirend/client';

export function SimulateDataloader500() {
  return (
    <>
      <UnirendHead>
        <title>Simulate Dataloader 500</title>
      </UnirendHead>
      <main>
        <h1>Simulate Dataloader 500</h1>
        <p>
          If you see this page, the demo loader did not return the expected 500
          error envelope.
        </p>
      </main>
    </>
  );
}
