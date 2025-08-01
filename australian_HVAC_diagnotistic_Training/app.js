// Melbourne HVAC Diagnostic Flowchart Application
class MelbourneHVACDiagnosticApp {
    constructor() {
        this.currentStep = 'safety';
        this.completedSteps = [];
        this.stepCount = 1;
        this.isAwaitingFeedback = false;
        this.selectedOption = null;
        this.currentScreen = 'welcome'; // 'welcome', 'diagnostic', 'congratulations'
        
        // Melbourne diagnostic steps data
        this.diagnosticSteps = {
            "safety": {
                "id": "safety",
                "title": "Safety First",
                "description": "Before beginning any diagnostic work, what should you do first?",
                "options": [
                    {
                        "id": "thermostat",
                        "text": "Check the thermostat settings",
                        "correct": false,
                        "explanation": "Safety must always come first. Never start diagnostics without proper safety procedures."
                    },
                    {
                        "id": "thermostat",
                        "text": "Disconnect power to the unit",
                        "correct": true,
                        "explanation": "Correct! Always disconnect power before beginning any diagnostic work for safety."
                    },
                    {
                        "id": "thermostat",
                        "text": "Check the air filter",
                        "correct": false,
                        "explanation": "While important, safety procedures must be completed first."
                    }
                ]
            },
            "thermostat": {
                "id": "thermostat",
                "title": "Thermostat Check",
                "description": "With power restored, the thermostat shows 23°C indoor temperature, set to 20°C. What should you check?",
                "options": [
                    {
                        "id": "electrical",
                        "text": "Verify thermostat is set to COOL mode",
                        "correct": true,
                        "explanation": "Correct! This is a fundamental check - ensuring the system is in cooling mode."
                    },
                    {
                        "id": "electrical",
                        "text": "Replace the thermostat immediately",
                        "correct": false,
                        "explanation": "Don't replace components without proper diagnosis first."
                    },
                    {
                        "id": "electrical",
                        "text": "Ignore the thermostat, check outdoors",
                        "correct": false,
                        "explanation": "The thermostat is a critical component that must be verified first."
                    }
                ]
            },
            "electrical": {
                "id": "electrical",
                "title": "Electrical Check",
                "description": "The thermostat is properly set. What electrical component should you check next?",
                "options": [
                    {
                        "id": "filter",
                        "text": "Check the circuit breaker",
                        "correct": true,
                        "explanation": "Correct! Circuit breakers can trip, cutting power to the HVAC system."
                    },
                    {
                        "id": "filter",
                        "text": "Replace the electrical panel",
                        "correct": false,
                        "explanation": "This is an extreme measure not warranted by the symptoms."
                    },
                    {
                        "id": "filter",
                        "text": "Check the main electrical service",
                        "correct": false,
                        "explanation": "Start with the specific circuit breaker for the HVAC system first."
                    }
                ]
            },
            "filter": {
                "id": "filter",
                "title": "Air Filter Inspection",
                "description": "Circuit breaker is fine. In Melbourne's variable climate, air filters are important. What should you check?",
                "options": [
                    {
                        "id": "outdoor",
                        "text": "Check if the air filter is dirty or clogged",
                        "correct": true,
                        "explanation": "Correct! Dirty filters restrict airflow and reduce cooling efficiency."
                    },
                    {
                        "id": "outdoor",
                        "text": "Remove the filter entirely",
                        "correct": false,
                        "explanation": "Never run the system without a filter - this can damage equipment."
                    },
                    {
                        "id": "outdoor",
                        "text": "Replace with a higher efficiency filter",
                        "correct": false,
                        "explanation": "First determine if the current filter is the problem."
                    }
                ]
            },
            "outdoor": {
                "id": "outdoor",
                "title": "Outdoor Unit Check",
                "description": "Filter is clean. Melbourne's variable weather can affect outdoor units. What should you inspect?",
                "options": [
                    {
                        "id": "capacitor",
                        "text": "Check for debris around the outdoor unit",
                        "correct": true,
                        "explanation": "Correct! Debris can block airflow and reduce cooling efficiency."
                    },
                    {
                        "id": "capacitor",
                        "text": "Pour water on the outdoor unit",
                        "correct": false,
                        "explanation": "This can damage electrical components and is not a proper diagnostic step."
                    },
                    {
                        "id": "capacitor",
                        "text": "Cover the outdoor unit",
                        "correct": false,
                        "explanation": "Covering the unit will restrict airflow and worsen the problem."
                    }
                ]
            },
            "capacitor": {
                "id": "capacitor",
                "title": "Component Testing",
                "description": "Outdoor unit is clear. The compressor isn't starting properly. What component commonly fails?",
                "options": [
                    {
                        "id": "complete",
                        "text": "Check the capacitor",
                        "correct": true,
                        "explanation": "Correct! Capacitors are common failure points that prevent compressor startup."
                    },
                    {
                        "id": "complete",
                        "text": "Replace the entire compressor",
                        "correct": false,
                        "explanation": "This is expensive and should only be done after proper diagnosis."
                    },
                    {
                        "id": "complete",
                        "text": "Add refrigerant immediately",
                        "correct": false,
                        "explanation": "Adding refrigerant without proper diagnosis can cause damage."
                    }
                ]
            }
        };

        // Step order for progress tracking
        this.stepOrder = ['safety', 'thermostat', 'electrical', 'filter', 'outdoor', 'capacitor'];
        
        this.stepTitles = {
            'safety': 'Safety First',
            'thermostat': 'Thermostat Check',
            'electrical': 'Electrical Check',
            'filter': 'Air Filter Inspection',
            'outdoor': 'Outdoor Unit Check',
            'capacitor': 'Component Testing'
        };

        this.init();
    }

    init() {
        this.showWelcomeScreen();
        this.bindEventListeners();
    }

    bindEventListeners() {
        // Use a more robust approach to bind event listeners
        this.bindStartButton();
        this.bindRestartButton();
        this.bindPracticeAgainButton();
    }

    bindStartButton() {
        const startBtn = document.getElementById('start-diagnosis-btn');
        if (startBtn) {
            startBtn.addEventListener('click', (e) => {
                e.preventDefault();
                console.log('Start diagnosis button clicked');
                this.startDiagnosis();
            });
        } else {
            console.error('Start diagnosis button not found');
        }
    }

    bindRestartButton() {
        const restartBtn = document.getElementById('restart-btn');
        if (restartBtn) {
            restartBtn.addEventListener('click', (e) => {
                e.preventDefault();
                console.log('Restart button clicked');
                this.restart();
            });
        }
    }

    bindPracticeAgainButton() {
        const practiceAgainBtn = document.getElementById('practice-again-btn');
        if (practiceAgainBtn) {
            practiceAgainBtn.addEventListener('click', (e) => {
                e.preventDefault();
                console.log('Practice again button clicked');
                this.restart();
            });
        }
    }

    bindContinueButton() {
        const continueBtn = document.getElementById('continue-btn');
        if (continueBtn) {
            continueBtn.addEventListener('click', (e) => {
                e.preventDefault();
                console.log('Continue button clicked');
                this.continueToNextStep();
            });
        }
    }

    showWelcomeScreen() {
        console.log('Showing welcome screen');
        this.currentScreen = 'welcome';
        
        const welcomeScreen = document.getElementById('welcome-screen');
        const diagnosticLayout = document.getElementById('diagnostic-layout');
        const congratulationsScreen = document.getElementById('congratulations-screen');
        
        if (welcomeScreen) welcomeScreen.classList.remove('hidden');
        if (diagnosticLayout) diagnosticLayout.classList.add('hidden');
        if (congratulationsScreen) congratulationsScreen.classList.add('hidden');
    }

    showDiagnosticScreen() {
        console.log('Showing diagnostic screen');
        this.currentScreen = 'diagnostic';
        
        const welcomeScreen = document.getElementById('welcome-screen');
        const diagnosticLayout = document.getElementById('diagnostic-layout');
        const congratulationsScreen = document.getElementById('congratulations-screen');
        
        if (welcomeScreen) welcomeScreen.classList.add('hidden');
        if (diagnosticLayout) diagnosticLayout.classList.remove('hidden');
        if (congratulationsScreen) congratulationsScreen.classList.add('hidden');
    }

    showCongratulationsScreen() {
        console.log('Showing congratulations screen');
        this.currentScreen = 'congratulations';
        
        const welcomeScreen = document.getElementById('welcome-screen');
        const diagnosticLayout = document.getElementById('diagnostic-layout');
        const congratulationsScreen = document.getElementById('congratulations-screen');
        
        if (welcomeScreen) welcomeScreen.classList.add('hidden');
        if (diagnosticLayout) diagnosticLayout.classList.add('hidden');
        if (congratulationsScreen) congratulationsScreen.classList.remove('hidden');
        
        // Re-bind the practice again button since it's now visible
        this.bindPracticeAgainButton();
        
        // Track completion with Google Analytics
        if (typeof gtag !== 'undefined') {
            gtag('event', 'diagnostic_completed', {
                event_category: 'training',
                event_label: 'melbourne_hvac_diagnostic'
            });
        }
    }

    startDiagnosis() {
        console.log('Starting diagnosis');
        // Track diagnosis start with Google Analytics
        if (typeof gtag !== 'undefined') {
            gtag('event', 'diagnosis_started', {
                event_category: 'training',
                event_label: 'melbourne_hvac_diagnostic'
            });
        }
        
        this.showDiagnosticScreen();
        this.renderCurrentStep();
        this.updateProgress();
    }

    // Fisher-Yates shuffle algorithm for randomizing array order
    shuffleArray(array) {
        const shuffled = [...array]; // Create a copy to avoid modifying original
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }

    renderCurrentStep() {
        const step = this.diagnosticSteps[this.currentStep];
        
        if (!step) {
            console.error('Step not found:', this.currentStep);
            return;
        }
        
        console.log('Rendering step:', this.currentStep);
        
        // Update step header
        const stepTitle = document.getElementById('step-title');
        const currentStepIndicator = document.getElementById('current-step');
        
        if (stepTitle) stepTitle.textContent = step.title;
        if (currentStepIndicator) currentStepIndicator.textContent = `Step ${this.stepCount}`;
        
        // Update step description
        const stepDescription = document.getElementById('step-description');
        if (stepDescription) stepDescription.textContent = step.description;

        // Clear and render options with randomized order
        const optionsContainer = document.getElementById('options-container');
        if (optionsContainer) {
            optionsContainer.innerHTML = '';

            // Randomize the order of options
            const shuffledOptions = this.shuffleArray(step.options);

            shuffledOptions.forEach((option, index) => {
                const optionButton = document.createElement('button');
                optionButton.className = 'option-button';
                optionButton.textContent = option.text;
                optionButton.setAttribute('data-option-id', option.id);
                optionButton.setAttribute('data-correct', option.correct);
                optionButton.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.selectOption(option);
                });
                optionsContainer.appendChild(optionButton);
            });
        }

        // Hide feedback section and reset state
        const feedbackSection = document.getElementById('feedback-section');
        if (feedbackSection) {
            feedbackSection.classList.add('hidden');
            feedbackSection.classList.remove('success', 'error');
        }
        
        this.isAwaitingFeedback = false;
        this.selectedOption = null;
    }

    selectOption(selectedOption) {
        if (this.isAwaitingFeedback) return;

        console.log('Option selected:', selectedOption.text);
        this.isAwaitingFeedback = true;
        this.selectedOption = selectedOption;
        
        // Track option selection with Google Analytics
        if (typeof gtag !== 'undefined') {
            gtag('event', 'option_selected', {
                event_category: 'training',
                event_label: `${this.currentStep}_${selectedOption.correct ? 'correct' : 'incorrect'}`,
                value: this.stepCount
            });
        }
        
        // Update option buttons to show selection
        const optionButtons = document.querySelectorAll('.option-button');
        optionButtons.forEach(button => {
            button.disabled = true;
            const buttonText = button.textContent;
            const isSelected = buttonText === selectedOption.text;
            if (isSelected) {
                button.classList.add(selectedOption.correct ? 'correct' : 'incorrect');
            } else {
                button.style.opacity = '0.6';
            }
        });

        // Show feedback
        this.showFeedback(selectedOption);
        
        // Bind continue button after feedback is shown
        setTimeout(() => {
            this.bindContinueButton();
        }, 100);
    }

    showFeedback(option) {
        const feedbackSection = document.getElementById('feedback-section');
        const feedbackIcon = document.getElementById('feedback-icon');
        const feedbackTitle = document.getElementById('feedback-title');
        const feedbackExplanation = document.getElementById('feedback-explanation');

        if (feedbackSection && feedbackIcon && feedbackTitle && feedbackExplanation) {
            // Set feedback content
            feedbackIcon.className = `feedback-icon ${option.correct ? 'success' : 'error'}`;
            feedbackTitle.textContent = option.correct ? 'Correct!' : 'Not Quite Right';
            feedbackExplanation.textContent = option.explanation;

            // Set feedback section style
            feedbackSection.classList.remove('hidden');
            feedbackSection.classList.add(option.correct ? 'success' : 'error');
            feedbackSection.classList.remove(option.correct ? 'error' : 'success');
        }
    }

    continueToNextStep() {
        if (!this.selectedOption) {
            console.error('No option selected');
            return;
        }

        console.log('Continuing to next step from:', this.currentStep);

        // Mark current step as completed
        if (!this.completedSteps.includes(this.currentStep)) {
            this.completedSteps.push(this.currentStep);
        }

        // Check if this is the last step
        if (this.currentStep === 'capacitor') {
            console.log('Last step completed, showing congratulations');
            this.showCongratulationsScreen();
            return;
        }

        // Navigate to next step
        const nextStepId = this.selectedOption.id;
        
        // Verify next step exists
        if (!this.diagnosticSteps[nextStepId]) {
            console.error('Next step not found:', nextStepId);
            return;
        }

        this.currentStep = nextStepId;
        this.stepCount++;
        
        console.log('Moving to step:', this.currentStep, 'Step count:', this.stepCount);
        
        // Update display
        this.renderCurrentStep();
        this.updateProgress();
    }

    updateProgress() {
        const progressList = document.getElementById('progress-list');
        
        if (!progressList) {
            console.error('Progress list element not found');
            return;
        }
        
        progressList.innerHTML = '';

        this.stepOrder.forEach((stepId, index) => {
            const stepDiv = document.createElement('div');
            stepDiv.className = 'progress-step';
            
            // Determine step state
            if (this.completedSteps.includes(stepId)) {
                stepDiv.classList.add('completed');
            } else if (stepId === this.currentStep) {
                stepDiv.classList.add('current');
            }

            // Create step number
            const stepNumber = document.createElement('div');
            stepNumber.className = 'progress-step-number';
            stepNumber.textContent = index + 1;

            // Create step text
            const stepText = document.createElement('div');
            stepText.className = 'progress-step-text';
            stepText.textContent = this.stepTitles[stepId];

            stepDiv.appendChild(stepNumber);
            stepDiv.appendChild(stepText);
            progressList.appendChild(stepDiv);
        });
    }

    restart() {
        console.log('Restarting application');
        // Track restart with Google Analytics
        if (typeof gtag !== 'undefined') {
            gtag('event', 'diagnosis_restarted', {
                event_category: 'training',
                event_label: 'melbourne_hvac_diagnostic'
            });
        }
        
        // Reset all application state
        this.currentStep = 'safety';
        this.completedSteps = [];
        this.stepCount = 1;
        this.isAwaitingFeedback = false;
        this.selectedOption = null;
        this.currentScreen = 'welcome';
        
        // Clear any existing feedback
        const feedbackSection = document.getElementById('feedback-section');
        if (feedbackSection) {
            feedbackSection.classList.add('hidden');
            feedbackSection.classList.remove('success', 'error');
        }
        
        // Show welcome screen
        this.showWelcomeScreen();
        
        // Re-bind event listeners to ensure they work
        this.bindEventListeners();
    }
}

// Utility function to track page views with Google Analytics
function trackPageView() {
    if (typeof gtag !== 'undefined') {
        gtag('config', 'G-1MDBG3TN2X', {
            page_title: 'Melbourne HVAC Diagnostic Training',
            page_location: window.location.href
        });
    }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing Melbourne HVAC app');
    
    // Track initial page view
    trackPageView();
    
    // Initialize the app
    const app = new MelbourneHVACDiagnosticApp();
    
    // Store reference globally for debugging
    window.melbourneHvacApp = app;
    
    // Additional Google Analytics event tracking
    if (typeof gtag !== 'undefined') {
        gtag('event', 'app_initialized', {
            event_category: 'training',
            event_label: 'melbourne_hvac_diagnostic'
        });
    }
});

// Track when user leaves the page
window.addEventListener('beforeunload', () => {
    if (typeof gtag !== 'undefined') {
        gtag('event', 'session_end', {
            event_category: 'training',
            event_label: 'melbourne_hvac_diagnostic'
        });
    }
});