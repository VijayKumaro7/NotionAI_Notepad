import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  Check,
  Moon,
  Sun,
  Menu,
  X,
  BookOpen,
  Lightbulb,
  Users,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { HeroWorkspacePreview } from "@/components/HeroWorkspacePreview";
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/_core/hooks/useAuth";
import { TemplateSelector } from "@/components/TemplateSelector";
import { NoteTemplate } from "@shared/templates";
import { Link, useLocation } from "wouter";
import {
  DEMO_SESSION_MS,
  adoptServerDeadline,
  startDemoSession,
} from "@/lib/demoSession";
import { trpc } from "@/lib/trpc";

export default function Landing() {
  const { theme, toggleTheme } = useTheme();
  const { isAuthenticated } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [, navigate] = useLocation();
  const startServerDemo = trpc.demo.start.useMutation();

  const handleTemplateSelect = async (
    template: NoteTemplate,
    customName?: string
  ) => {
    sessionStorage.setItem(
      "selectedTemplate",
      JSON.stringify({
        template,
        customName: customName || template.name,
      })
    );

    // Signed-out visitors get a timed demo rather than a sign-in wall. The
    // chosen template is kept in sessionStorage and applied once they arrive.
    if (!isAuthenticated) {
      startDemoSession();

      // The server holds the deadline against a hashed visitor id when it is
      // configured to, which is what survives clearing site data. Its answer
      // wins; if it cannot answer, the local deadline stands on its own.
      try {
        const result = await startServerDemo.mutateAsync({
          durationMs: DEMO_SESSION_MS,
        });
        if (result.tracked && result.expiresAt) {
          adoptServerDeadline(result.expiresAt);
        }
      } catch {
        // Offline or the endpoint is unavailable — browser-only limit.
      }
    }

    navigate("/app");
  };

  const features = [
    {
      title: "Writing assistance",
      description:
        "Summarise, rewrite or brainstorm. The instructions stay on the server and your notes stay on your device.",
    },
    {
      title: "Encrypted locally",
      description:
        "AES-GCM runs in your browser, and a recovery phrase carries your key between devices.",
    },
    {
      title: "Organised simply",
      description:
        "Folders, tags, drag-and-drop and a bin for second thoughts.",
    },
    {
      title: "Local-first",
      description: "Instant to open, readable offline, synced when you are.",
    },
  ];

  const pricingPlans = [
    {
      name: "Starter",
      price: "Free",
      description: "Perfect for getting started",
      features: [
        "Unlimited notes and folders",
        "Local encryption",
        "Basic AI features",
        "Search functionality",
      ],
      cta: "Get Started",
      highlighted: false,
    },
    {
      name: "Pro",
      price: "$9.99",
      period: "/month",
      description: "For power users",
      features: [
        "Everything in Starter",
        "Advanced AI features",
        "Voice transcription",
        "Collaborative sharing",
        "Version history",
        "Priority support",
      ],
      cta: "Start Free Trial",
      highlighted: true,
    },
    {
      name: "Enterprise",
      price: "Custom",
      description: "For teams and organizations",
      features: [
        "Everything in Pro",
        "Team management",
        "Advanced analytics",
        "Custom integrations",
        "Dedicated support",
        "SLA guarantee",
      ],
      cta: "Contact Sales",
      highlighted: false,
    },
  ];

  const tutorials = [
    {
      title: "Getting Started",
      description:
        "Learn the basics of creating and organizing your first notes",
      icon: BookOpen,
      crop: "editor" as const,
    },
    {
      title: "Collaboration Guide",
      description: "Master real-time collaboration and sharing with your team",
      icon: Users,
      crop: "people" as const,
    },
    {
      title: "AI Features",
      description:
        "Unlock the power of AI-assisted writing and content generation",
      icon: Lightbulb,
      crop: "assistant" as const,
    },
  ];

  const navLinks = [
    { label: "Features", href: "#features" },
    { label: "Resources", href: "#resources" },
    { label: "Pricing", href: "#pricing" },
  ];

  const primaryAction = (
    <Button
      onClick={() => navigate(isAuthenticated ? "/app" : "/login")}
      className="h-10 rounded-sm px-5"
    >
      {isAuthenticated ? "Dashboard" : "Sign In"}
    </Button>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Navigation */}
      <header className="sticky top-0 z-50 bg-background border-b-2 border-foreground">
        <nav
          aria-label="Primary"
          className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 flex justify-between items-center h-16"
        >
          <Logo size="md" variant="full" />

          <div className="hidden md:flex items-center gap-8">
            {navLinks.map(link => (
              <a
                key={link.href}
                href={link.href}
                className="text-sm font-medium text-foreground border-b border-transparent hover:text-foreground hover:border-foreground transition-colors"
              >
                {link.label}
              </a>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={toggleTheme}
              aria-label={
                theme === "dark"
                  ? "Switch to light mode"
                  : "Switch to dark mode"
              }
              className="p-2 rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              {theme === "dark" ? (
                <Sun className="w-5 h-5" />
              ) : (
                <Moon className="w-5 h-5" />
              )}
            </button>

            {primaryAction}

            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label={
                mobileMenuOpen
                  ? "Close navigation menu"
                  : "Open navigation menu"
              }
              aria-expanded={mobileMenuOpen}
              className="md:hidden p-2 rounded-sm hover:bg-muted"
            >
              {mobileMenuOpen ? <X /> : <Menu />}
            </button>
          </div>
        </nav>

        {mobileMenuOpen && (
          <div className="md:hidden border-t border-border bg-background px-4 py-4 space-y-1">
            {navLinks.map(link => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className="block px-3 py-2 rounded-sm text-sm font-medium text-foreground hover:bg-muted"
              >
                {link.label}
              </a>
            ))}
            <Button
              onClick={() => {
                setMobileMenuOpen(false);
                navigate(isAuthenticated ? "/app" : "/login");
              }}
              className="w-full mt-2 rounded-sm"
            >
              {isAuthenticated ? "Dashboard" : "Sign In"}
            </Button>
          </div>
        )}
      </header>

      <main>
        {/* Hero */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 md:pt-20 pb-16">
          <div className="grid lg:grid-cols-[7fr_5fr] gap-10 lg:gap-14 items-end">
            <div className="animate-fade-in">
              <p className="flex items-center gap-3 text-xs font-medium uppercase tracking-[0.14em] text-primary mb-6">
                <span className="h-px w-8 bg-primary" aria-hidden="true" />
                Private notes · Considered AI
              </p>
              <h1 className="text-5xl sm:text-6xl lg:text-7xl xl:text-[5.5rem]">
                Write it down.{" "}
                <em className="block text-primary">Keep it yours.</em>
              </h1>
            </div>

            <div className="space-y-7 animate-fade-in animation-delay-100">
              <p className="text-lg text-muted-foreground max-w-[40ch]">
                An encrypted, local-first notebook with real-time collaboration
                and an assistant that only speaks when spoken to.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button
                  onClick={() => setShowTemplateSelector(true)}
                  className="h-12 rounded-sm px-6 text-sm"
                >
                  Start Creating
                  <ArrowRight className="w-4 h-4" />
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    document
                      .getElementById("resources")
                      ?.scrollIntoView({ behavior: "smooth" })
                  }
                  className="h-12 rounded-sm px-6 text-sm border-foreground"
                >
                  See How It Works
                </Button>
              </div>
            </div>
          </div>

          {/* The product itself, drawn from the app's own theme tokens so it
              tracks the light/dark switch and costs no extra request. Below lg
              it crops to the AI panel, the part that stays legible small. */}
          <div className="mt-14 border border-foreground bg-card">
            <HeroWorkspacePreview crop="detail" className="lg:hidden" />
            <HeroWorkspacePreview crop="full" className="hidden lg:block" />
          </div>
        </section>

        {/* Features */}
        <section
          id="features"
          className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20 border-t border-border scroll-mt-16"
        >
          <div className="grid lg:grid-cols-[4fr_8fr] gap-10 lg:gap-14">
            <h2 className="text-4xl md:text-5xl">
              Four ideas, carried through.
            </h2>
            <ol>
              {features.map((feature, idx) => (
                <li
                  key={feature.title}
                  className={`grid sm:grid-cols-[3.5rem_1fr_1.4fr] gap-x-6 gap-y-1 py-6 border-t ${idx === 0 ? "border-foreground" : "border-border"}`}
                >
                  <span className="font-display text-sm text-accent tabular-nums">
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  <h3 className="text-xl font-display font-medium tracking-tight">
                    {feature.title}
                  </h3>
                  <p className="text-muted-foreground">{feature.description}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Resources */}
        <section
          id="resources"
          className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20 border-t border-border scroll-mt-16"
        >
          <div className="max-w-2xl mb-12">
            <h2 className="text-4xl md:text-5xl mb-4">Learn how to use it.</h2>
            <p className="text-lg text-muted-foreground">
              Short guides to the editor, sharing and the assistant.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {tutorials.map(tutorial => {
              const Icon = tutorial.icon;
              return (
                <article
                  key={tutorial.title}
                  className="group border border-border bg-card"
                >
                  <div className="relative h-48 overflow-hidden border-b border-border">
                    <HeroWorkspacePreview crop={tutorial.crop} fill />
                  </div>
                  <div className="p-6">
                    <Icon
                      className="w-5 h-5 text-accent mb-3"
                      aria-hidden="true"
                    />
                    <h3 className="text-xl font-display font-medium tracking-tight mb-2">
                      {tutorial.title}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {tutorial.description}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {/* Pricing */}
        <section
          id="pricing"
          className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20 border-t border-border scroll-mt-16"
        >
          <div className="max-w-2xl mb-12">
            <h2 className="text-4xl md:text-5xl mb-4">
              Simple, transparent pricing.
            </h2>
            <p className="text-lg text-muted-foreground">
              Choose the plan that fits how you write.
            </p>
          </div>
          <div className="grid md:grid-cols-3 border border-foreground">
            {pricingPlans.map((plan, idx) => (
              <div
                key={plan.name}
                className={`p-8 flex flex-col ${idx > 0 ? "border-t md:border-t-0 md:border-l border-foreground" : ""} ${plan.highlighted ? "on-primary bg-primary text-primary-foreground" : "bg-card"}`}
              >
                <p
                  className={`text-xs font-medium uppercase tracking-[0.12em] mb-4 ${plan.highlighted ? "text-primary-foreground/80" : "text-accent"}`}
                >
                  {plan.highlighted ? "Most popular" : "\u00a0"}
                </p>
                <h3 className="text-2xl font-display font-medium tracking-tight mb-1">
                  {plan.name}
                </h3>
                <p
                  className={`mb-6 text-sm ${plan.highlighted ? "text-primary-foreground/80" : "text-muted-foreground"}`}
                >
                  {plan.description}
                </p>
                <div className="mb-6 font-display tracking-tight">
                  <span className="text-5xl">{plan.price}</span>
                  {plan.period && (
                    <span
                      className={`text-sm font-sans ml-1 ${plan.highlighted ? "text-primary-foreground/80" : "text-muted-foreground"}`}
                    >
                      {plan.period}
                    </span>
                  )}
                </div>
                <Button
                  onClick={() => navigate(isAuthenticated ? "/app" : "/login")}
                  variant={plan.highlighted ? "secondary" : "outline"}
                  className={`w-full h-11 rounded-sm mb-8 ${plan.highlighted ? "focus-visible:ring-offset-primary" : "border-foreground"}`}
                >
                  {plan.cta}
                </Button>
                <ul className="space-y-3">
                  {plan.features.map(feature => (
                    <li
                      key={feature}
                      className="flex items-center gap-3 text-sm"
                    >
                      <Check
                        className={`w-4 h-4 shrink-0 ${plan.highlighted ? "text-primary-foreground/80" : "text-accent"}`}
                        aria-hidden="true"
                      />
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* Closing call to action and footer share one dark band */}
      <footer className="on-primary bg-primary text-primary-foreground">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-8">
          <h2 className="text-4xl md:text-6xl max-w-[16ch] mb-8">
            A better place to keep your thinking.
          </h2>
          <Button
            onClick={() => setShowTemplateSelector(true)}
            variant="secondary"
            className="h-12 rounded-sm px-6 focus-visible:ring-offset-primary"
          >
            Get Started Free
            <ArrowRight className="w-4 h-4" />
          </Button>

          <div className="grid md:grid-cols-3 gap-8 mt-16 pt-8 border-t border-primary-foreground/25 text-sm">
            <div className="space-y-3">
              <p className="font-display text-xl font-semibold tracking-tight">
                Notepad <em className="font-normal">AI</em>
              </p>
              <p className="text-primary-foreground/80">
                A private notebook with an assistant on call.
              </p>
            </div>
            <nav aria-label="Product">
              <h3 className="font-semibold mb-3 text-sm">Product</h3>
              <ul className="space-y-2 text-primary-foreground/80">
                {navLinks.map(link => (
                  <li key={link.href}>
                    <a
                      href={link.href}
                      className="text-inherit hover:text-primary-foreground underline-offset-4 hover:underline"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            <nav aria-label="Project">
              <h3 className="font-semibold mb-3 text-sm">Project</h3>
              <ul className="space-y-2 text-primary-foreground/80">
                {[
                  [
                    "GitHub",
                    "https://github.com/VijayKumaro7/NotionAI_Notepad",
                  ],
                  [
                    "Report an Issue",
                    "https://github.com/VijayKumaro7/NotionAI_Notepad/issues",
                  ],
                  [
                    "License",
                    "https://github.com/VijayKumaro7/NotionAI_Notepad/blob/main/LICENSE",
                  ],
                ].map(([label, href]) => (
                  <li key={label}>
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-inherit hover:text-primary-foreground underline-offset-4 hover:underline"
                    >
                      {label}
                    </a>
                  </li>
                ))}
                <li>
                  <Link
                    href="/privacy"
                    className="text-inherit hover:text-primary-foreground underline-offset-4 hover:underline"
                  >
                    Privacy
                  </Link>
                </li>
              </ul>
            </nav>
          </div>
          <p className="mt-10 text-xs text-primary-foreground/70">
            &copy; 2026 Notepad AI. All rights reserved.
          </p>
        </div>
      </footer>

      {/* Template Selector Modal */}
      <TemplateSelector
        isOpen={showTemplateSelector}
        onClose={() => setShowTemplateSelector(false)}
        onSelectTemplate={handleTemplateSelect}
      />
    </div>
  );
}
