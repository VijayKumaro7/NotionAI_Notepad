import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import NotesApp from "@/pages/NotesApp";
import Landing from "@/pages/Landing";
import Login from "@/pages/Login";
import { VerifyEmail, ResetPassword } from "@/pages/EmailAction";
import SharedNoteView from "@/pages/SharedNoteView";
import CollaborativeNote from "./pages/CollaborativeNote";
import { Redirect, Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { useAuth } from "@/_core/hooks/useAuth";
import { isDemoSessionActive } from "@/lib/demoSession";
import { BrandedLoader } from "./components/BrandedLoader";

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
      {/* A note shared with you directly, opened by id rather than a link. */}
      <Route path="/note/:noteId">
        {() => (isAuthenticated ? <CollaborativeNote /> : <Redirect to="/login" />)}
      </Route>
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
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
