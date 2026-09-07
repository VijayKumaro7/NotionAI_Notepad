import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Redirect, Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { useAuth } from "@/_core/hooks/useAuth";
import { isDemoSessionActive } from "@/lib/demoSession";
import { BrandedLoader } from "./components/BrandedLoader";

/**
 * Pages load when their route is reached, not before.
 *
 * Every page used to be a static import, so someone opening the landing page
 * downloaded the whole workspace with it: the editor, the AI panels, the voice
 * recorder, and the CRDT library behind collaborative editing — none of which
 * that page can use. The routes below are the things a person is doing, and
 * they are rarely doing two of them at once.
 *
 * NotFound stays eager. It is fifty lines, it is the fallback for a route that
 * matched nothing, and fetching a chunk to say "not found" would be the one
 * case where the wait is longer than the page.
 */
const NotesApp = lazy(() => import("@/pages/NotesApp"));
const Landing = lazy(() => import("@/pages/Landing"));
const Login = lazy(() => import("@/pages/Login"));
const SharedNoteView = lazy(() => import("@/pages/SharedNoteView"));

// EmailAction exports two components rather than a default, and lazy() wants a
// module whose default is the component — hence the unwrapping.
const VerifyEmail = lazy(() =>
  import("@/pages/EmailAction").then(module => ({
    default: module.VerifyEmail,
  }))
);
const ResetPassword = lazy(() =>
  import("@/pages/EmailAction").then(module => ({
    default: module.ResetPassword,
  }))
);

/**
 * URL structure:
 *   /                    → public landing page
 *   /login               → sign-in, and the second factor when one is owed;
 *                          the server decides which of the two it shows
 *   /app                 → workspace; also reachable during a running demo
 *                          session, which NotesApp ends by sending the visitor
 *                          home when the 30 minutes are up
 *   /shared/:shareToken  → public shared-note view (token-gated)
 *   /404 and fallback    → not found
 */
function Router() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return <BrandedLoader />;
  }

  return (
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/login" component={Login} />
      {/* Where the links in verification and reset email land. */}
      <Route path="/verify-email" component={VerifyEmail} />
      <Route path="/reset-password" component={ResetPassword} />
      {/* Static hosts and bookmarks commonly hit /index.html directly */}
      <Route path="/index.html">
        <Redirect to="/" />
      </Route>
      {/* Function child, not a plain expression: Router does not re-render on
          navigation — only Switch/Route do — so an inline ternary would mount
          the element built during Router's last render. Starting a demo and
          navigating in the same tick would then mount a stale Redirect. */}
      <Route path="/app">
        {() =>
          isAuthenticated || isDemoSessionActive() ? (
            <NotesApp />
          ) : (
            <Redirect to="/" />
          )
        }
      </Route>
      <Route path="/shared/:shareToken" component={SharedNoteView} />
      <Route path="/404" component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light" switchable>
        <TooltipProvider>
          <Toaster />
          {/* The same loader the router shows while the session resolves, so a
              page arriving over the network looks like the app thinking rather
              than a second kind of waiting. */}
          <Suspense fallback={<BrandedLoader />}>
            <Router />
          </Suspense>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
