import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import NotesApp from "@/pages/NotesApp";
import Landing from "@/pages/Landing";
import SharedNoteView from "@/pages/SharedNoteView";
import { Redirect, Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { useAuth } from "@/_core/hooks/useAuth";
import { BrandedLoader } from "./components/BrandedLoader";

/**
 * URL structure:
 *   /                    → public landing page
 *   /app                 → authenticated workspace (redirects to / when signed out)
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
      {/* Static hosts and bookmarks commonly hit /index.html directly */}
      <Route path="/index.html">
        <Redirect to="/" />
      </Route>
      <Route path="/app">
        {isAuthenticated ? <NotesApp /> : <Redirect to="/" />}
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
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
