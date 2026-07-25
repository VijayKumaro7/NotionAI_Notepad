import { useState } from 'react';
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
  Plus,
  Play,
  BookOpen,
  Lightbulb,
  Users,
} from 'lucide-react';
import { Logo } from '@/components/Logo';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/_core/hooks/useAuth';
import { getLoginUrl } from '@/const';
import { TemplateSelector } from '@/components/TemplateSelector';
import { NoteTemplate } from '@/lib/templates';
import { useLocation } from 'wouter';

export default function Landing() {
  const { theme, toggleTheme } = useTheme();
  const { isAuthenticated } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [, navigate] = useLocation();

  const handleTemplateSelect = (template: NoteTemplate, customName?: string) => {
    sessionStorage.setItem('selectedTemplate', JSON.stringify({
      template,
      customName: customName || template.name,
    }));
    // /app is auth-guarded — unauthenticated users sign in first; the chosen
    // template is kept in sessionStorage and applied once they reach the app.
    if (isAuthenticated) {
      navigate('/app');
    } else {
      window.location.href = getLoginUrl();
    }
  };

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
        'Advanced AI features',
        'Voice transcription',
        'Collaborative sharing',
        'Version history',
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
        'Team management',
        'Advanced analytics',
        'Custom integrations',
        'Dedicated support',
        'SLA guarantee',
      ],
      cta: 'Contact Sales',
      highlighted: false,
    },
  ];

  const tutorials = [
    {
      title: 'Getting Started',
      description: 'Learn the basics of creating and organizing your first notes',
      icon: BookOpen,
      image: 'https://d2xsxph8kpxj0f.cloudfront.net/310519663301308772/AeSLLWWHCxggUch52tjEXX/screenshot-editor-aHmns9HXck98s4kmZB2PSE.webp',
    },
    {
      title: 'Collaboration Guide',
      description: 'Master real-time collaboration and sharing with your team',
      icon: Users,
      image: 'https://d2xsxph8kpxj0f.cloudfront.net/310519663301308772/AeSLLWWHCxggUch52tjEXX/screenshot-collaboration-CRkzNeiJHi4jWZjnByeY38.webp',
    },
    {
      title: 'AI Features',
      description: 'Unlock the power of AI-assisted writing and content generation',
      icon: Lightbulb,
      image: 'https://d2xsxph8kpxj0f.cloudfront.net/310519663301308772/AeSLLWWHCxggUch52tjEXX/screenshot-templates-hLt9NAfLqawqFRGBJrGZaX.webp',
    },
  ];

  return (
    <div className={`min-h-screen ${theme === 'dark' ? 'bg-slate-950' : 'bg-white'}`}>
      {/* Navigation */}
      <nav className={`fixed top-0 w-full z-50 backdrop-blur-md ${theme === 'dark' ? 'bg-slate-950/80 border-slate-800' : 'bg-white/80 border-slate-200'} border-b transition-all duration-300`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="group cursor-pointer transform group-hover:scale-105 transition-transform duration-300">
              <Logo size="md" variant="full" />
            </div>

            {/* Desktop Menu */}
            <div className="hidden md:flex items-center gap-8">
              <a href="#features" className={`text-sm font-medium transition-colors duration-300 hover:text-primary ${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'}`}>Features</a>
              <a href="#resources" className={`text-sm font-medium transition-colors duration-300 hover:text-primary ${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'}`}>Resources</a>
              <a href="#pricing" className={`text-sm font-medium transition-colors duration-300 hover:text-primary ${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'}`}>Pricing</a>
            </div>

            <div className="flex items-center gap-4">
              <button
                onClick={toggleTheme}
                aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                className={`p-2 rounded-lg transition-all duration-300 hover:scale-110 ${theme === 'dark' ? 'bg-slate-800 text-yellow-400' : 'bg-slate-100 text-slate-700'}`}
              >
                {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
              </button>

              {isAuthenticated ? (
                <Button
                  onClick={() => navigate('/app')}
                  className="bg-gradient-to-r from-primary to-secondary hover:opacity-90 text-white border-0 transform hover:scale-105 transition-all duration-300 shadow-lg hover:shadow-xl"
                >
                  Dashboard
                </Button>
              ) : (
                <Button
                  onClick={() => window.location.href = getLoginUrl()}
                  className="bg-gradient-to-r from-primary to-secondary hover:opacity-90 text-white border-0 transform hover:scale-105 transition-all duration-300 shadow-lg hover:shadow-xl"
                >
                  Sign In
                </Button>
              )}

              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
                aria-expanded={mobileMenuOpen}
                className="md:hidden p-2"
              >
                {mobileMenuOpen ? <X /> : <Menu />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Menu Panel */}
        {mobileMenuOpen && (
          <div className={`md:hidden border-t px-4 py-4 space-y-1 ${theme === 'dark' ? 'bg-slate-950/95 border-slate-800' : 'bg-white/95 border-slate-200'}`}>
            {[
              { label: 'Features', href: '#features' },
              { label: 'Resources', href: '#resources' },
              { label: 'Pricing', href: '#pricing' },
            ].map(link => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`block px-3 py-2 rounded-lg text-sm font-medium hover:text-primary ${theme === 'dark' ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-700 hover:bg-slate-100'}`}
              >
                {link.label}
              </a>
            ))}
            <Button
              onClick={() => {
                setMobileMenuOpen(false);
                if (isAuthenticated) {
                  navigate('/app');
                } else {
                  window.location.href = getLoginUrl();
                }
              }}
              className="w-full mt-2 bg-gradient-to-r from-primary to-secondary hover:opacity-90 text-white border-0"
            >
              {isAuthenticated ? 'Dashboard' : 'Sign In'}
            </Button>
          </div>
        )}
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-4 sm:px-6 lg:px-8 overflow-hidden">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            {/* Left Content */}
            <div className="space-y-8 animate-fade-in">
              <div className="space-y-4">
                <h1 className={`text-5xl md:text-6xl font-bold leading-tight ${theme === 'dark' ? 'text-white' : 'text-slate-900'} animate-slide-up`}>
                  Your AI-Powered
                  <span className="block bg-gradient-to-r from-primary via-secondary to-accent bg-clip-text text-transparent">
                    Note-Taking Assistant
                  </span>
                </h1>
                <p className={`text-xl ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'} animate-slide-up animation-delay-100`}>
                  Create, organize, and collaborate on notes with the power of AI. Local-first encryption keeps your thoughts private and secure.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-4 animate-slide-up animation-delay-200">
                <Button
                  onClick={() => setShowTemplateSelector(true)}
                  className="bg-gradient-to-r from-primary to-secondary hover:opacity-90 text-white border-0 px-8 py-6 text-lg font-semibold transform hover:scale-105 transition-all duration-300 shadow-lg hover:shadow-xl group"
                >
                  Start Creating
                  <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </Button>
                <Button
                  variant="outline"
                  onClick={() => document.getElementById('resources')?.scrollIntoView({ behavior: 'smooth' })}
                  className={`px-8 py-6 text-lg font-semibold transform hover:scale-105 transition-all duration-300 ${theme === 'dark' ? 'border-slate-700 text-white hover:bg-slate-800' : 'border-slate-300 text-slate-900 hover:bg-slate-50'}`}
                >
                  See How It Works
                  <Play className="ml-2 w-5 h-5" />
                </Button>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-8 animate-slide-up animation-delay-300">
                <div className={`p-4 rounded-lg backdrop-blur-sm ${theme === 'dark' ? 'bg-slate-800/50' : 'bg-slate-100/50'}`}>
                  <div className="text-2xl font-bold text-primary">10K+</div>
                  <div className={`text-sm ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>Active Users</div>
                </div>
                <div className={`p-4 rounded-lg backdrop-blur-sm ${theme === 'dark' ? 'bg-slate-800/50' : 'bg-slate-100/50'}`}>
                  <div className="text-2xl font-bold text-secondary">1M+</div>
                  <div className={`text-sm ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>Notes Created</div>
                </div>
                <div className={`p-4 rounded-lg backdrop-blur-sm ${theme === 'dark' ? 'bg-slate-800/50' : 'bg-slate-100/50'}`}>
                  <div className="text-2xl font-bold text-accent">99.9%</div>
                  <div className={`text-sm ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>Uptime</div>
                </div>
              </div>
            </div>

            {/* Right Image */}
            <div className="relative h-96 md:h-full animate-float">
              <div className="absolute inset-0 bg-gradient-to-r from-primary/20 to-secondary/20 rounded-3xl blur-3xl"></div>
              <img
                src="https://d2xsxph8kpxj0f.cloudfront.net/310519663301308772/AeSLLWWHCxggUch52tjEXX/screenshot-editor-aHmns9HXck98s4kmZB2PSE.webp"
                alt="Editor Interface"
                className="relative w-full h-full object-cover rounded-2xl shadow-2xl transform hover:scale-105 transition-transform duration-500"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-primary/5 to-transparent pointer-events-none"></div>
        <div className="max-w-7xl mx-auto relative z-10">
          <div className="text-center space-y-4 mb-16 animate-fade-in">
            <h2 className={`text-4xl md:text-5xl font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
              Powerful Features
            </h2>
            <p className={`text-xl ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
              Everything you need for productive note-taking
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((feature, idx) => {
              const Icon = feature.icon;
              return (
                <div
                  key={idx}
                  className={`group p-6 rounded-xl backdrop-blur-sm transition-all duration-500 hover:scale-105 cursor-pointer animate-slide-up ${theme === 'dark' ? 'bg-slate-800/50 hover:bg-slate-700/50' : 'bg-slate-50/50 hover:bg-slate-100/50'}`}
                  style={{ animationDelay: `${idx * 100}ms` }}
                >
                  <div className="w-12 h-12 bg-gradient-to-br from-primary to-secondary rounded-lg flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                    <Icon className="w-6 h-6 text-white" />
                  </div>
                  <h3 className={`text-lg font-semibold mb-2 ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                    {feature.title}
                  </h3>
                  <p className={`text-sm ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
                    {feature.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Resources Section */}
      <section id="resources" className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center space-y-4 mb-16 animate-fade-in">
            <h2 className={`text-4xl md:text-5xl font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
              Learn How to Use
            </h2>
            <p className={`text-xl ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
              Explore tutorials and guides to master Notepad AI
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {tutorials.map((tutorial, idx) => {
              const Icon = tutorial.icon;
              return (
                <div
                  key={idx}
                  className={`group rounded-xl overflow-hidden transition-all duration-500 hover:scale-105 cursor-pointer animate-slide-up ${theme === 'dark' ? 'bg-slate-800' : 'bg-slate-100'}`}
                  style={{ animationDelay: `${idx * 100}ms` }}
                >
                  <div className="relative h-48 overflow-hidden">
                    <img
                      src={tutorial.image}
                      alt={tutorial.title}
                      className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"></div>
                    <div className="absolute bottom-4 left-4 w-10 h-10 bg-white rounded-full flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                      <Icon className="w-6 h-6 text-primary" />
                    </div>
                  </div>
                  <div className="p-6">
                    <h3 className={`text-lg font-semibold mb-2 ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                      {tutorial.title}
                    </h3>
                    <p className={`text-sm ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
                      {tutorial.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-20 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-secondary/5 to-transparent pointer-events-none"></div>
        <div className="max-w-7xl mx-auto relative z-10">
          <div className="text-center space-y-4 mb-16 animate-fade-in">
            <h2 className={`text-4xl md:text-5xl font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
              Simple, Transparent Pricing
            </h2>
            <p className={`text-xl ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
              Choose the perfect plan for your needs
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {pricingPlans.map((plan, idx) => (
              <div
                key={idx}
                className={`relative rounded-2xl p-8 transition-all duration-500 hover:scale-105 transform animate-slide-up ${
                  plan.highlighted
                    ? 'bg-gradient-to-br from-primary to-secondary text-white shadow-2xl ring-2 ring-primary/60'
                    : `${theme === 'dark' ? 'bg-slate-800' : 'bg-slate-50'} ${theme === 'dark' ? 'border border-slate-700' : 'border border-slate-200'}`
                }`}
                style={{ animationDelay: `${idx * 100}ms` }}
              >
                {plan.highlighted && (
                  <div className="absolute -top-4 left-1/2 transform -translate-x-1/2 bg-gradient-to-r from-yellow-400 to-orange-400 text-black px-4 py-1 rounded-full text-sm font-semibold">
                    Most Popular
                  </div>
                )}

                <h3 className={`text-2xl font-bold mb-2 ${plan.highlighted ? 'text-white' : theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                  {plan.name}
                </h3>
                <p className={`mb-6 ${plan.highlighted ? 'text-white/80' : theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
                  {plan.description}
                </p>

                <div className="mb-6">
                  <span className={`text-4xl font-bold ${plan.highlighted ? 'text-white' : 'text-primary'}`}>
                    {plan.price}
                  </span>
                  {plan.period && (
                    <span className={`${plan.highlighted ? 'text-white/80' : theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
                      {plan.period}
                    </span>
                  )}
                </div>

                <Button
                  onClick={() => {
                    if (isAuthenticated) {
                      navigate('/app');
                    } else {
                      window.location.href = getLoginUrl();
                    }
                  }}
                  className={`w-full mb-8 font-semibold py-3 transform hover:scale-105 transition-all duration-300 ${
                    plan.highlighted
                      ? 'bg-white text-primary hover:bg-slate-100'
                      : `bg-gradient-to-r from-primary to-secondary text-white hover:opacity-90 border-0`
                  }`}
                >
                  {plan.cta}
                </Button>

                <div className="space-y-4">
                  {plan.features.map((feature, fidx) => (
                    <div key={fidx} className="flex items-center gap-3">
                      <Check className={`w-5 h-5 ${plan.highlighted ? 'text-white/80' : 'text-primary'}`} />
                      <span className={`text-sm ${plan.highlighted ? 'text-white/90' : theme === 'dark' ? 'text-slate-300' : 'text-slate-700'}`}>
                        {feature}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-primary/10 to-secondary/10"></div>
        <div className="max-w-4xl mx-auto relative z-10 text-center space-y-8 animate-fade-in">
          <h2 className={`text-4xl md:text-5xl font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
            Ready to Transform Your Note-Taking?
          </h2>
          <p className={`text-xl ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
            Join thousands of users who are already using Notepad AI to organize their thoughts and boost productivity.
          </p>
          <Button
            onClick={() => setShowTemplateSelector(true)}
            className="bg-gradient-to-r from-primary to-secondary hover:opacity-90 text-white border-0 px-8 py-6 text-lg font-semibold transform hover:scale-105 transition-all duration-300 shadow-lg hover:shadow-xl"
          >
            Get Started Free
            <ArrowRight className="ml-2 w-5 h-5" />
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className={`border-t ${theme === 'dark' ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-slate-50'}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="grid md:grid-cols-3 gap-8 mb-8">
            <div>
              <div className="mb-4">
                <Logo size="sm" variant="full" />
              </div>
              <p className={`text-sm ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
                Your AI-powered note-taking assistant
              </p>
            </div>
            <div>
              <h4 className={`font-semibold mb-4 ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>Product</h4>
              <ul className={`space-y-2 text-sm ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
                <li><a href="#features" className="hover:text-primary transition-colors">Features</a></li>
                <li><a href="#pricing" className="hover:text-primary transition-colors">Pricing</a></li>
                <li><a href="#resources" className="hover:text-primary transition-colors">Resources</a></li>
              </ul>
            </div>
            <div>
              <h4 className={`font-semibold mb-4 ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>Project</h4>
              <ul className={`space-y-2 text-sm ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
                <li><a href="https://github.com/VijayKumaro7/NotionAI_Notepad" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">GitHub</a></li>
                <li><a href="https://github.com/VijayKumaro7/NotionAI_Notepad/issues" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">Report an Issue</a></li>
                <li><a href="https://github.com/VijayKumaro7/NotionAI_Notepad/blob/main/LICENSE" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">License</a></li>
              </ul>
            </div>
          </div>
          <div className={`border-t ${theme === 'dark' ? 'border-slate-800' : 'border-slate-200'} pt-8 text-center text-sm ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
            <p>&copy; 2026 Notepad AI. All rights reserved.</p>
          </div>
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
