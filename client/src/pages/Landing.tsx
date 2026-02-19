import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sparkles,
  ArrowRight,
  Check,
  Zap,
  Shield,
  Feather,
  Moon,
  Sun,
  Menu,
  X,
} from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/_core/hooks/useAuth';
import { getLoginUrl } from '@/const';

export default function Landing() {
  const { theme, toggleTheme } = useTheme();
  const { isAuthenticated } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const features = [
    {
      icon: Sparkles,
      title: 'AI-Powered Writing',
      description: 'Get intelligent suggestions, auto-completion, and content generation powered by advanced AI.',
    },
    {
      icon: Shield,
      title: 'End-to-End Encryption',
      description: 'Your notes are encrypted locally. Your privacy is our priority.',
    },
    {
      icon: Feather,
      title: 'Seamless Organization',
      description: 'Drag-and-drop folders, tags, and hierarchical organization for perfect structure.',
    },
    {
      icon: Zap,
      title: 'Lightning Fast',
      description: 'Local-first architecture ensures instant access and zero latency.',
    },
  ];

  const templates = [
    {
      title: 'Meeting Notes',
      description: 'Structured template for capturing action items and decisions',
      icon: '📋',
    },
    {
      title: 'Project Plan',
      description: 'Comprehensive planning template with timelines and milestones',
      icon: '📊',
    },
    {
      title: 'Daily Journal',
      description: 'Personal reflection template with prompts and gratitude section',
      icon: '📝',
    },
    {
      title: 'Research Notes',
      description: 'Academic-style template with citations and source tracking',
      icon: '🔬',
    },
  ];

  const pricingPlans = [
    {
      name: 'Starter',
      price: 'Free',
      description: 'Perfect for getting started',
      features: [
        'Unlimited notes and folders',
        'Local encryption',
        'Basic AI features',
        'Search functionality',
      ],
      cta: 'Get Started',
      highlighted: false,
    },
    {
      name: 'Pro',
      price: '$9.99',
      period: '/month',
      description: 'For power users',
      features: [
        'Everything in Starter',
        'Advanced AI capabilities',
        'Voice transcription',
        'Cloud backup',
        'Priority support',
      ],
      cta: 'Start Free Trial',
      highlighted: true,
    },
    {
      name: 'Enterprise',
      price: 'Custom',
      description: 'For teams and organizations',
      features: [
        'Everything in Pro',
        'Team collaboration',
        'Advanced analytics',
        'Custom integrations',
        'Dedicated support',
      ],
      cta: 'Contact Sales',
      highlighted: false,
    },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="container flex items-center justify-between h-16">
          <div className="flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-primary" />
            <span className="text-xl font-bold gradient-text">Notion AI</span>
          </div>

          {/* Desktop Menu */}
          <div className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-sm font-medium hover:text-primary transition-colors">
              Features
            </a>
            <a href="#templates" className="text-sm font-medium hover:text-primary transition-colors">
              Templates
            </a>
            <a href="#pricing" className="text-sm font-medium hover:text-primary transition-colors">
              Pricing
            </a>
          </div>

          {/* Right Section */}
          <div className="flex items-center gap-4">
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg hover:bg-muted transition-colors"
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? (
                <Sun className="w-5 h-5" />
              ) : (
                <Moon className="w-5 h-5" />
              )}
            </button>

            {isAuthenticated ? (
              <Button className="btn-premium text-sm">Dashboard</Button>
            ) : (
              <a href={getLoginUrl()}>
                <Button className="btn-premium text-sm">Sign In</Button>
              </a>
            )}

            {/* Mobile Menu Button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded-lg hover:bg-muted transition-colors"
            >
              {mobileMenuOpen ? (
                <X className="w-5 h-5" />
              ) : (
                <Menu className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-border bg-card">
            <div className="container py-4 space-y-3">
              <a href="#features" className="block text-sm font-medium hover:text-primary">
                Features
              </a>
              <a href="#templates" className="block text-sm font-medium hover:text-primary">
                Templates
              </a>
              <a href="#pricing" className="block text-sm font-medium hover:text-primary">
                Pricing
              </a>
            </div>
          </div>
        )}
      </nav>

      {/* Hero Section */}
      <section className="container py-20 md:py-32 space-y-8">
        <div className="max-w-3xl mx-auto text-center space-y-6 animate-fade-in-up">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 rounded-full border border-primary/20">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold text-primary">Introducing Notion AI Notepad</span>
          </div>

          <h1 className="text-hero font-bold leading-tight">
            Your <span className="gradient-text">AI-Powered</span> Note-Taking Companion
          </h1>

          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Experience the future of note-taking with intelligent suggestions, end-to-end encryption, and seamless organization. Your thoughts, perfectly organized.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
            {isAuthenticated ? (
              <Button className="btn-premium gap-2">
                Go to Dashboard
                <ArrowRight className="w-4 h-4" />
              </Button>
            ) : (
              <>
                <a href={getLoginUrl()}>
                  <Button className="btn-premium gap-2 w-full sm:w-auto">
                    Start Free
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </a>
                <Button className="btn-premium-outline w-full sm:w-auto">
                  Watch Demo
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Hero Image Placeholder */}
        <div className="mt-16 rounded-2xl border border-border bg-card/50 backdrop-blur-sm p-8 md:p-12 min-h-96 flex items-center justify-center">
          <div className="text-center space-y-4">
            <Sparkles className="w-16 h-16 text-primary/50 mx-auto" />
            <p className="text-muted-foreground">Beautiful UI Preview Coming Soon</p>
          </div>
        </div>
      </section>

      {/* Divider */}
      <div className="container">
        <div className="divider-gradient" />
      </div>

      {/* Features Section */}
      <section id="features" className="container py-20 md:py-32 space-y-12">
        <div className="text-center space-y-4 animate-fade-in-up">
          <h2 className="text-heading-lg">Powerful Features</h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Everything you need to write, organize, and share your thoughts
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <div
                key={index}
                className="card-premium group hover:border-primary/50 animate-fade-in-up"
                style={{ animationDelay: `${index * 100}ms` }}
              >
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
                    <Icon className="w-6 h-6 text-primary" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-xl font-semibold">{feature.title}</h3>
                    <p className="text-muted-foreground">{feature.description}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Divider */}
      <div className="container">
        <div className="divider-gradient" />
      </div>

      {/* Templates Section */}
      <section id="templates" className="container py-20 md:py-32 space-y-12">
        <div className="text-center space-y-4 animate-fade-in-up">
          <h2 className="text-heading-lg">Sneak Peek: Templates</h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Start with professionally designed templates to jumpstart your productivity
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {templates.map((template, index) => (
            <div
              key={index}
              className="card-premium-gradient hover:shadow-lg transition-all duration-300 cursor-pointer group animate-fade-in-up"
              style={{ animationDelay: `${index * 100}ms` }}
            >
              <div className="text-4xl mb-4">{template.icon}</div>
              <h3 className="text-lg font-semibold mb-2">{template.title}</h3>
              <p className="text-sm text-muted-foreground">{template.description}</p>
              <div className="mt-4 flex items-center gap-2 text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="text-sm font-semibold">Use Template</span>
                <ArrowRight className="w-4 h-4" />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Divider */}
      <div className="container">
        <div className="divider-gradient" />
      </div>

      {/* Pricing Section */}
      <section id="pricing" className="container py-20 md:py-32 space-y-12">
        <div className="text-center space-y-4 animate-fade-in-up">
          <h2 className="text-heading-lg">Simple, Transparent Pricing</h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Choose the perfect plan for your needs. Always flexible, always fair.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {pricingPlans.map((plan, index) => (
            <div
              key={index}
              className={`rounded-2xl p-8 transition-all duration-300 animate-fade-in-up ${
                plan.highlighted
                  ? 'card-premium-gradient border-2 border-primary/50 shadow-lg scale-105'
                  : 'card-premium'
              }`}
              style={{ animationDelay: `${index * 100}ms` }}
            >
              {plan.highlighted && (
                <div className="mb-4 inline-flex items-center gap-2 px-3 py-1 bg-primary/20 rounded-full border border-primary/50">
                  <Zap className="w-4 h-4 text-primary" />
                  <span className="text-xs font-semibold text-primary">Most Popular</span>
                </div>
              )}

              <h3 className="text-2xl font-bold mb-2">{plan.name}</h3>
              <div className="mb-4">
                <span className="text-4xl font-bold">{plan.price}</span>
                {plan.period && <span className="text-muted-foreground">{plan.period}</span>}
              </div>
              <p className="text-muted-foreground mb-6">{plan.description}</p>

              <Button
                className={`w-full mb-8 ${
                  plan.highlighted ? 'btn-premium' : 'btn-premium-outline'
                }`}
              >
                {plan.cta}
              </Button>

              <div className="space-y-4">
                {plan.features.map((feature, featureIndex) => (
                  <div key={featureIndex} className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                    <span className="text-sm">{feature}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA Section */}
      <section className="container py-20 md:py-32">
        <div className="card-premium-gradient rounded-3xl p-12 md:p-16 text-center space-y-6 animate-fade-in-up">
          <h2 className="text-heading-md">Ready to Transform Your Note-Taking?</h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Join thousands of users who are already experiencing the power of AI-assisted note-taking.
          </p>
          {isAuthenticated ? (
            <Button className="btn-premium gap-2 mx-auto">
              Go to Dashboard
              <ArrowRight className="w-4 h-4" />
            </Button>
          ) : (
            <a href={getLoginUrl()}>
              <Button className="btn-premium gap-2 mx-auto">
                Start Free Today
                <ArrowRight className="w-4 h-4" />
              </Button>
            </a>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-card/50 backdrop-blur-sm">
        <div className="container py-12">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-primary" />
                <span className="font-bold gradient-text">Notion AI</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Your AI-powered note-taking companion
              </p>
            </div>
            <div className="space-y-4">
              <h4 className="font-semibold">Product</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#features" className="hover:text-primary transition-colors">Features</a></li>
                <li><a href="#templates" className="hover:text-primary transition-colors">Templates</a></li>
                <li><a href="#pricing" className="hover:text-primary transition-colors">Pricing</a></li>
              </ul>
            </div>
            <div className="space-y-4">
              <h4 className="font-semibold">Company</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#" className="hover:text-primary transition-colors">About</a></li>
                <li><a href="#" className="hover:text-primary transition-colors">Blog</a></li>
                <li><a href="#" className="hover:text-primary transition-colors">Contact</a></li>
              </ul>
            </div>
            <div className="space-y-4">
              <h4 className="font-semibold">Legal</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#" className="hover:text-primary transition-colors">Privacy</a></li>
                <li><a href="#" className="hover:text-primary transition-colors">Terms</a></li>
                <li><a href="#" className="hover:text-primary transition-colors">Security</a></li>
              </ul>
            </div>
          </div>

          <div className="divider-gradient mb-8" />

          <div className="flex flex-col md:flex-row items-center justify-between">
            <p className="text-sm text-muted-foreground">
              © 2026 Notion AI Notepad. All rights reserved.
            </p>
            <div className="flex items-center gap-4 mt-4 md:mt-0">
              <a href="#" className="text-muted-foreground hover:text-primary transition-colors">
                Twitter
              </a>
              <a href="#" className="text-muted-foreground hover:text-primary transition-colors">
                GitHub
              </a>
              <a href="#" className="text-muted-foreground hover:text-primary transition-colors">
                LinkedIn
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
