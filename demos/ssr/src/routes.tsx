import { RouteObject, Outlet } from "react-router";
import RouteErrorBoundary from "../../../src/lib/router-utils/RouteErrorBoundary";
import Home from "./pages/Home";
import About from "./pages/About";
import Contact from "./pages/Contact";
import AppLayout from "./components/AppLayout";
import CustomNotFound from "./components/CustomNotFound";
import CustomApplicationError from "./components/CustomApplicationError";

// App layout component that passes Outlet to AppLayout as children
function App() {
  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  );
}

export const routes: RouteObject[] = [
  {
    path: "/",
    element: <App />,
    errorElement: (
      <RouteErrorBoundary
        NotFoundComponent={CustomNotFound}
        ApplicationErrorComponent={CustomApplicationError}
      />
    ),
    children: [
      {
        index: true,
        element: <Home />,
      },
      {
        path: "about",
        element: <About />,
      },
      {
        path: "contact",
        element: <Contact />,
      },
      {
        path: "test-error-thrown",
        element: null,
        loader: async () => {
          throw new Error(
            "Simulated error thrown from test-error-thrown loader",
          );
        },
      },
    ],
  },
];
