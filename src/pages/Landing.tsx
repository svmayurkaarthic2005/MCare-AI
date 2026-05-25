import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Activity, Shield, Sparkles, FileHeart, Pill, Clock, ChevronLeft, ChevronRight, Calendar, MessageSquare, Phone, Linkedin, Users, Heart, Stethoscope, Award, Menu, X, Mail } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { ThemeToggle } from "@/components/ThemeToggle";
import { usePageTransition } from "@/App";
import doctorVideo from "@/assets/doctor_video.mp4";

const animationStyles = `
  @keyframes fadeInSlideUp {
    from {
      opacity: 0;
      transform: translateY(30px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  [data-animate-card] {
    will-change: opacity, transform;
  }

  [data-animate-card].animate-fade-in-slide-up {
    animation: fadeInSlideUp 0.7s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
  }

  .animate-delay-100 { animation-delay: 0.1s; }
  .animate-delay-200 { animation-delay: 0.2s; }
  .animate-delay-300 { animation-delay: 0.3s; }
  .animate-delay-400 { animation-delay: 0.4s; }
  .animate-delay-500 { animation-delay: 0.5s; }
  .animate-delay-600 { animation-delay: 0.6s; }
`;

const Landing = () => {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [visibleCards, setVisibleCards] = useState<Record<string, boolean>>({});
  const { startTransition } = usePageTransition();
  const navigate = useNavigate();

  const slides = [
    {
      icon: <Sparkles className="h-16 w-16" />,
      title: "AI Health Assistant",
      description: "Get instant answers to your health questions with our intelligent AI assistant. Available 24/7 to help you understand your medications, symptoms, and health records.",
      gradient: "from-primary to-primary-light"
    },
    {
      icon: <Calendar className="h-16 w-16" />,
      title: "Health Timeline",
      description: "Visualize your complete health journey. Track appointments, lab results, procedures, and important health events all in a chronological timeline.",
      gradient: "from-accent to-primary"
    },
    {
      icon: <FileHeart className="h-16 w-16" />,
      title: "Secure Records",
      description: "Upload, organize, and access your medical records anytime, anywhere. HIPAA-compliant encryption keeps your health data safe and private.",
      gradient: "from-primary-dark to-primary"
    }
  ];

  const nextSlide = () => {
    setCurrentSlide((prev) => (prev + 1) % slides.length);
  };

  const prevSlide = () => {
    setCurrentSlide((prev) => (prev - 1 + slides.length) % slides.length);
  };

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % slides.length);
    }, 4000);

    return () => clearInterval(interval);
  }, [slides.length]);

  useEffect(() => {
    const observedCards = new Set<string>();
    
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const cardId = entry.target.id;
          if (!observedCards.has(cardId)) {
            observedCards.add(cardId);
            setVisibleCards((prev) => ({
              ...prev,
              [cardId]: true,
            }));
            observer.unobserve(entry.target);
          }
        }
      });
    }, {
      threshold: 0.15,
      rootMargin: "0px 0px -50px 0px",
    });

    const timer = setTimeout(() => {
      const cards = document.querySelectorAll("[data-animate-card]");
      cards.forEach((card) => observer.observe(card));
    }, 100);

    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  return (
    <div className="min-h-screen relative isolate overflow-hidden">
      <style>{animationStyles}</style>
      {/* Navigation Bar - Modern Professional Design */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/30 bg-background/75 backdrop-blur-2xl shadow-lg shadow-primary/5">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="relative flex items-center justify-between py-3 lg:py-5 gap-2">
            {/* Logo with Enhanced Hover */}
            <Link
              to="/"
              className="flex items-center gap-2 sm:gap-3 group flex-shrink-0"
            >
              <div className="relative h-9 w-9 sm:h-10 sm:w-10 lg:h-12 lg:w-12 rounded-lg bg-gradient-to-br from-primary via-primary-light to-accent flex items-center justify-center shadow-lg shadow-primary/30 transition-all duration-500 group-hover:shadow-2xl group-hover:shadow-primary/50 group-hover:scale-110 group-active:scale-95">
                <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-primary/20 via-transparent to-accent/20 opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-sm"></div>
                <Activity className="h-5 w-5 sm:h-6 sm:w-6 lg:h-7 lg:w-7 text-primary-foreground relative z-10" />
              </div>
              <div className="hidden sm:block">
                <h1 className="text-lg sm:text-xl lg:text-2xl font-bold bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent group-hover:from-primary group-hover:to-primary-light transition-all duration-500">MCare</h1>
                <p className="text-xs lg:text-sm text-muted-foreground group-hover:text-primary/80 transition-colors duration-500">Healthcare Platform</p>
              </div>
            </Link>

            {/* Desktop Navigation - Centered with Enhanced Effects */}
            <div className="hidden lg:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 items-center gap-1 xl:gap-2">
              {[
                { label: "Home", path: "/" },
                { label: "Services", path: "/services" },
                { label: "About", path: "/about" }
              ].map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className="group relative px-4 py-2 rounded-xl text-sm font-medium text-muted-foreground transition-all duration-300 hover:text-foreground"
                >
                  {/* Background gradient on hover */}
                  <div className="absolute inset-0 rounded-lg bg-gradient-to-r from-primary/10 via-accent/10 to-primary/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300 blur-sm"></div>

                  {/* Border effect on hover */}
                  <div className="absolute inset-0 rounded-lg border border-transparent group-hover:border-primary/30 transition-colors duration-300"></div>

                  {/* Text with underline animation */}
                  <span className="relative flex items-center gap-1">
                    {item.label}
                    <span className="absolute bottom-0 left-0 w-0 h-0.5 bg-gradient-to-r from-primary to-accent rounded-full group-hover:w-full transition-all duration-500"></span>
                  </span>
                </Link>
              ))}
            </div>

            {/* Theme Toggle & Get Started Button - Desktop Only */}
            <div className="hidden md:flex lg:flex items-center gap-2 lg:gap-3">
              <ThemeToggle />
              <Link to="/auth">
                <Button
                  size="sm"
                  className="relative group bg-gradient-to-r from-primary to-primary-light hover:from-primary-light hover:to-accent text-primary-foreground border border-primary/50 hover:border-accent/50 shadow-lg shadow-primary/30 hover:shadow-xl hover:shadow-primary/50 transition-all duration-500 hover:scale-105 active:scale-95 font-semibold px-4 lg:px-6 text-xs sm:text-sm"
                >
                  <span className="relative z-10 flex items-center gap-2">
                    Get Started
                    <span className="inline-block transition-transform duration-500 group-hover:translate-x-1">→</span>
                  </span>
                  <div className="absolute inset-0 rounded-md bg-gradient-to-r from-primary/0 via-white/20 to-primary/0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 group-hover:animate-pulse"></div>
                </Button>
              </Link>
            </div>

            {/* Mobile Menu Button with Smooth Animation */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden lg:hidden p-2 hover:bg-accent/20 active:bg-accent/30 rounded-lg transition-all duration-300 relative group"
              aria-label="Toggle menu"
            >
              <div className="absolute inset-0 rounded-lg bg-gradient-to-r from-primary/10 to-accent/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
              {mobileMenuOpen ? (
                <X className="h-5 w-5 sm:h-6 sm:w-6 relative z-10 transition-transform duration-300 rotate-90" />
              ) : (
                <Menu className="h-5 w-5 sm:h-6 sm:w-6 relative z-10 transition-transform duration-300 group-hover:rotate-180" />
              )}
            </button>
          </div>

          {/* Mobile Menu with Smooth Animation */}
          <div
            className={`lg:hidden overflow-hidden transition-all duration-500 ease-in-out ${mobileMenuOpen ? 'max-h-80 opacity-100' : 'max-h-0 opacity-0'
              }`}
          >
            <div className="py-4 border-t border-primary/20 bg-gradient-to-b from-primary/5 to-accent/5 rounded-xl mt-2">
              <div className="flex flex-col gap-2 px-2">
                {[
                  { label: "Home", path: "/" },
                  { label: "Services", path: "/services" },
                  { label: "About", path: "/about" }
                ].map((item) => (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setMobileMenuOpen(false)}
                    className="group relative px-4 py-3 rounded-lg text-sm font-medium transition-all duration-300"
                  >
                    {/* Background hover effect */}
                    <div className="absolute inset-0 rounded-lg bg-gradient-to-r from-primary/10 via-accent/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>

                    {/* Border hover effect */}
                    <div className="absolute inset-0 rounded-lg border border-transparent group-hover:border-primary/30 transition-colors duration-300"></div>

                    {/* Text */}
                    <span className="relative z-10 text-muted-foreground group-hover:text-foreground transition-colors duration-300 flex items-center gap-2">
                      {item.label}
                      <span className="inline-block opacity-0 transition-all duration-300 group-hover:opacity-100 group-hover:translate-x-1">→</span>
                    </span>
                  </Link>
                ))}

                {/* Mobile Theme Toggle & Get Started Button */}
                <div className="flex items-center gap-3 pt-2">
                  <ThemeToggle />
                  <Link to="/auth" onClick={() => setMobileMenuOpen(false)} className="flex-1">
                    <Button
                      size="sm"
                      className="w-full bg-gradient-to-r from-primary to-primary-light hover:from-primary-light hover:to-accent text-primary-foreground shadow-lg shadow-primary/30 hover:shadow-xl hover:shadow-primary/50 transition-all duration-500 active:scale-95 font-semibold"
                    >
                      Get Started
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section id="home" className="relative min-h-[75vh] md:min-h-screen flex items-center justify-center overflow-hidden pt-12 sm:pt-16">
        {/* Video background - plays on all screen sizes */}
        <video
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover z-[-1]"
          aria-hidden="true"
        >
          <source src={doctorVideo} type="video/mp4" />
        </video>
        <div className="absolute inset-0 z-[1] bg-gradient-to-b from-background/40 via-background/20 to-background/40 md:from-background/20 md:via-transparent md:to-background/20" />
        <div className="container relative z-10 mx-auto px-3 sm:px-4 py-12 sm:py-20 w-full flex items-center justify-center">
          <div className="max-w-4xl mx-auto text-center space-y-6 sm:space-y-8 w-full">

            <h1 className="text-4xl sm:text-5xl md:text-7xl font-bold tracking-tight">
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-accent via-primary-light to-primary drop-shadow-lg">Your Health, </span>
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-primary to-primary-light">
                Connected & Secure
              </span>
            </h1>

            <p className="text-base sm:text-lg md:text-2xl max-w-2xl mx-auto leading-relaxed font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-primary-light">
              Manage your health records, track medications, and get AI-powered health insights—all in one secure platform.
            </p>

            <div className="pt-2 sm:pt-4 flex justify-center w-full">
              <Link
                to="/auth"
                className="group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-lg inline-block"
              >
                <div className="relative h-12 sm:h-14 rounded-lg overflow-hidden shadow-lg transition-shadow duration-300 group-hover:shadow-xl group-active:shadow-xl">
                  {/* Gradient border wrapper */}
                  <div className="absolute inset-0 rounded-lg bg-gradient-to-r from-primary to-primary-light opacity-40" />
                  {/* Button surface with slide-up fill */}
                  <div className="relative z-10 flex h-12 sm:h-14 items-center justify-center px-6 sm:px-8 rounded-lg ring-1 ring-border text-base sm:text-lg font-medium text-foreground overflow-hidden">
                    {/* Slide-up accent background */}
                    <span className="absolute inset-0 bg-accent origin-bottom scale-y-0 transition-transform duration-500 ease-out group-hover:scale-y-100 group-active:scale-y-100" aria-hidden="true" />
                    {/* Text with color inversion */}
                    <span className="relative z-10 transition-colors duration-500 ease-out group-hover:text-primary-foreground group-active:text-primary-foreground">
                      Get Started Free
                    </span>
                  </div>
                </div>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Carousel Section */}
      <section className="py-24 bg-gradient-to-b from-secondary/30 to-background">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold mb-4">Powerful Features</h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Discover what makes MCare the complete health management solution
            </p>
          </div>

          <div className="max-w-5xl mx-auto">
            <div className="relative">
              {/* Carousel Content */}
              <div className="overflow-hidden rounded-xl">
                <div
                  className="flex transition-transform duration-500 ease-in-out"
                  style={{ transform: `translateX(-${currentSlide * 100}%)` }}
                >
                  {slides.map((slide, index) => (
                    <div
                      key={index}
                      className="min-w-full px-4"
                    >
                      <div className={`bg-gradient-to-br ${slide.gradient} rounded-xl p-12 md:p-16 text-white shadow-2xl`}>
                        <div className="flex flex-col items-center text-center space-y-6">
                          <div className="p-6 bg-white/20 rounded-md backdrop-blur-sm">
                            {slide.icon}
                          </div>
                          <h3 className="text-3xl md:text-4xl font-bold">
                            {slide.title}
                          </h3>
                          <p className="text-lg md:text-xl opacity-90 max-w-2xl leading-relaxed">
                            {slide.description}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Indicators */}
              <div className="flex justify-center gap-2 mt-8">
                {slides.map((_, index) => (
                  <button
                    key={index}
                    onClick={() => setCurrentSlide(index)}
                    className={`h-2 rounded-full transition-all ${index === currentSlide
                        ? 'w-8 bg-primary'
                        : 'w-2 bg-muted-foreground/30 hover:bg-muted-foreground/50'
                      }`}
                    aria-label={`Go to slide ${index + 1}`}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-24">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold mb-4">Everything You Need</h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Comprehensive health management tools designed for your well-being
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
            <FeatureCard
              id="card-1"
              isVisible={visibleCards["card-1"] || false}
              icon={<Sparkles className="h-8 w-8" />}
              title="AI Health Assistant"
              description="Get personalized health insights and answers to your questions with our AI-powered assistant"
            />
            <FeatureCard
              id="card-2"
              isVisible={visibleCards["card-2"] || false}
              icon={<Clock className="h-8 w-8" />}
              title="Health Timeline"
              description="Track your health journey with a comprehensive timeline of all your medical records and events"
            />
            <FeatureCard
              id="card-3"
              isVisible={visibleCards["card-3"] || false}
              icon={<FileHeart className="h-8 w-8" />}
              title="Records Management"
              description="Upload, organize, and access your medical records securely from anywhere"
            />
            <FeatureCard
              id="card-4"
              isVisible={visibleCards["card-4"] || false}
              icon={<Shield className="h-8 w-8" />}
              title="HIPAA Compliant"
              description="Your health data is encrypted and protected with industry-leading security"
            />
            <FeatureCard
              id="card-5"
              isVisible={visibleCards["card-5"] || false}
              icon={<Activity className="h-8 w-8" />}
              title="Health Insights"
              description="Get actionable insights from your health data to make informed decisions"
            />
            <FeatureCard
              id="card-6"
              isVisible={visibleCards["card-6"] || false}
              icon={<Phone className="h-8 w-8" />}
              title="WhatsApp Prescription Delivery"
              description="Receive your prescriptions directly on WhatsApp after your appointment for easy access and quick reference"
            />
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 bg-gradient-to-b from-background to-secondary/30">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto text-center space-y-8 bg-gradient-to-br from-primary to-primary-light rounded-xl p-12 md:p-16 text-primary-foreground shadow-2xl">
            <h2 className="text-4xl md:text-5xl font-bold">
              Ready to Take Control of Your Health?
            </h2>
            <p className="text-xl opacity-90 max-w-2xl mx-auto">
              Join thousands of users managing their health with MCare
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
              <Link to="/auth" className="group focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 rounded-lg">
                <div className="relative h-14 rounded-lg overflow-hidden shadow-lg transition-shadow duration-300 group-hover:shadow-2xl">
                  {/* Light background with border */}
                  <div className="absolute inset-0 rounded-lg bg-white/10" />
                  {/* Button surface with slide-up fill */}
                  <div className="relative z-10 flex h-14 items-center justify-center px-8 rounded-lg bg-white text-lg font-medium text-blue-600 overflow-hidden">
                    {/* Slide-up blue background */}
                    <span className="absolute inset-0 bg-blue-600 origin-bottom scale-y-0 transition-transform duration-500 ease-out group-hover:scale-y-100" aria-hidden="true" />
                    {/* Text with color inversion */}
                    <span className="relative z-10 transition-colors duration-500 ease-out group-hover:text-white">
                      Get Started Free
                    </span>
                  </div>
                </div>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Contact Section */}
      <section className="py-20 md:py-32 bg-gradient-to-b from-background via-secondary/10 to-background">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto text-center space-y-12">
            {/* Header */}
            <div className="space-y-4 md:space-y-6">
              <div className="inline-block">
                <span className="px-4 py-2 rounded-full text-sm font-semibold bg-primary/10 text-primary border border-primary/20">
                  Get In Touch
                </span>
              </div>
              <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold bg-gradient-to-r from-foreground via-foreground to-foreground/70 bg-clip-text text-transparent">
                Let's Connect
              </h2>
              <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
                Have questions about MCare? Our team is ready to assist you. Reach out through your preferred channel.
              </p>
            </div>

            {/* Contact Cards */}
            <div className="flex flex-wrap gap-3 justify-center items-center pt-4 sm:gap-4">
              {/* WhatsApp Card */}
              <a
                id="contact-card-1"
                data-animate-card
                href="https://wa.me/919445431413"
                target="_blank"
                rel="noopener noreferrer"
                className="group relative px-3 py-2 sm:px-6 sm:py-4 rounded-lg bg-gradient-to-br from-[#25D366]/10 via-card to-card border border-[#25D366]/20 hover:border-[#25D366]/50 transition-all duration-500 hover:shadow-lg hover:shadow-[#25D366]/15 hover:-translate-y-0.5 flex items-center gap-2 sm:gap-3 w-auto animate-fade-in-slide-up animate-delay-100"
                style={{ opacity: 0, transform: 'translateY(30px)' }}
              >
                {/* Gradient background overlay */}
                <div className="absolute inset-0 bg-gradient-to-br from-[#25D366]/5 to-transparent rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                
                {/* Content */}
                <div className="relative z-10 text-left">
                  <div className="inline-flex items-center justify-center h-8 w-8 sm:h-10 sm:w-10 rounded-md bg-[#25D366]/20 group-hover:bg-[#25D366]/30 transition-colors duration-300 sm:mb-2">
                    <Phone className="h-4 w-4 sm:h-5 sm:w-5 text-[#25D366]" />
                  </div>
                  <div className="hidden sm:block">
                    <h3 className="text-sm font-bold text-foreground">WhatsApp</h3>
                    <p className="text-xs text-[#25D366]">+91 9445431413</p>
                  </div>
                </div>
              </a>

              {/* LinkedIn Card */}
              <a
                id="contact-card-2"
                data-animate-card
                href="https://www.linkedin.com/in/mayur005"
                target="_blank"
                rel="noopener noreferrer"
                className="group relative px-3 py-2 sm:px-6 sm:py-4 rounded-lg bg-gradient-to-br from-[#0A66C2]/10 via-card to-card border border-[#0A66C2]/20 hover:border-[#0A66C2]/50 transition-all duration-500 hover:shadow-lg hover:shadow-[#0A66C2]/15 hover:-translate-y-0.5 flex items-center gap-2 sm:gap-3 w-auto animate-fade-in-slide-up animate-delay-200"
                style={{ opacity: 0, transform: 'translateY(30px)' }}
              >
                {/* Gradient background overlay */}
                <div className="absolute inset-0 bg-gradient-to-br from-[#0A66C2]/5 to-transparent rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                
                {/* Content */}
                <div className="relative z-10 text-left">
                  <div className="inline-flex items-center justify-center h-8 w-8 sm:h-10 sm:w-10 rounded-md bg-[#0A66C2]/20 group-hover:bg-[#0A66C2]/30 transition-colors duration-300 sm:mb-2">
                    <Linkedin className="h-4 w-4 sm:h-5 sm:w-5 text-[#0A66C2]" />
                  </div>
                  <div className="hidden sm:block">
                    <h3 className="text-sm font-bold text-foreground">LinkedIn</h3>
                    <p className="text-xs text-[#0A66C2]">Connect with us</p>
                  </div>
                </div>
              </a>

              {/* Gmail Card */}
              <a
                id="contact-card-3"
                data-animate-card
                href="mailto:svmayurkaarthic@gmail.com"
                className="group relative px-3 py-2 sm:px-6 sm:py-4 rounded-lg bg-gradient-to-br from-[#EA4335]/10 via-card to-card border border-[#EA4335]/20 hover:border-[#EA4335]/50 transition-all duration-500 hover:shadow-lg hover:shadow-[#EA4335]/15 hover:-translate-y-0.5 flex items-center gap-2 sm:gap-3 w-auto animate-fade-in-slide-up animate-delay-300"
                style={{ opacity: 0, transform: 'translateY(30px)' }}
              >
                {/* Gradient background overlay */}
                <div className="absolute inset-0 bg-gradient-to-br from-[#EA4335]/5 to-transparent rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                
                {/* Content */}
                <div className="relative z-10 text-left">
                  <div className="inline-flex items-center justify-center h-8 w-8 sm:h-10 sm:w-10 rounded-md bg-[#EA4335]/20 group-hover:bg-[#EA4335]/30 transition-colors duration-300 sm:mb-2">
                    <Mail className="h-4 w-4 sm:h-5 sm:w-5 text-[#EA4335]" />
                  </div>
                  <div className="hidden sm:block">
                    <h3 className="text-sm font-bold text-foreground">Email</h3>
                    <p className="text-xs text-[#EA4335]">svmayurkaarthic@gmail.com</p>
                  </div>
                </div>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 border-t border-border/50">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
            <p>&copy; {new Date().getFullYear()} MCare. All rights reserved.</p>
            <p>
              Designed by{" "}
              <a
                href="https://www.linkedin.com/in/mayur005"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary hover:underline"
              >
                Mayur Kaarthic S V
              </a>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
};

const FeatureCard = ({ id, isVisible, icon, title, description }: { id: string; isVisible: boolean; icon: React.ReactNode; title: string; description: string }) => {
  const cardIndex = parseInt(id.split('-')[1]) - 1;
  const delayClass = ['animate-delay-100', 'animate-delay-200', 'animate-delay-300', 'animate-delay-400', 'animate-delay-500', 'animate-delay-600'][cardIndex % 6];
  
  return (
    <div 
      id={id}
      data-animate-card
      className={`group relative p-8 rounded-lg bg-card border border-border/50 hover:border-primary/50 transition-all duration-500 hover:shadow-2xl hover:shadow-primary/10 hover:-translate-y-2 ${
        isVisible ? `animate-fade-in-slide-up ${delayClass}` : ''
      }`}
      style={!isVisible ? { opacity: 0, transform: 'translateY(30px)' } : undefined}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-accent/5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
      <div className="relative space-y-3">
        <div className="inline-flex p-3 rounded-lg bg-primary/10 text-primary mb-4 group-hover:scale-110 group-hover:bg-primary/20 transition-all duration-300">
          {icon}
        </div>
        <h3 className="text-xl font-semibold mb-3">{title}</h3>
        <p className="text-muted-foreground leading-relaxed">{description}</p>
      </div>
    </div>
  );
};

export default Landing;
