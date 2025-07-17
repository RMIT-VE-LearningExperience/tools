// Australian HVAC Diagnostic Flowchart Application
class AustralianHVACDiagnosticApp {
    constructor() {
        this.currentStep = 'safety_check';
        this.completedSteps = [];
        this.stepCount = 1;
        this.isAwaitingFeedback = false;
        this.selectedOption = null;
        
        // Australian diagnostic steps data
        this.diagnosticSteps = {
            "safety_check": {
                "id": "safety_check",
                "title": "Safety Protocols",
                "description": "Before beginning any diagnostic work, ensure proper safety procedures are followed according to Australian electrical safety standards.",
                "options": [
                    {
                        "id": "thermostat_check",
                        "text": "Test RCD/safety switch at main switchboard",
                        "correct": true,
                        "explanation": "Correct! Australian electrical safety standards require RCD/safety switch testing before any electrical work. This protects against electrical hazards and follows AS/NZS 3000:2018 Wiring Rules."
                    },
                    {
                        "id": "thermostat_check",
                        "text": "Start checking electrical components immediately",
                        "correct": false,
                        "explanation": "Incorrect. Australian safety standards require RCD/safety switch testing first. Always follow electrical safety protocols before diagnostic work. However, we'll continue with the next step."
                    }
                ]
            },
            "thermostat_check": {
                "id": "thermostat_check",
                "title": "Thermostat Verification",
                "description": "Check thermostat settings and operation. Customer reports thermostat set to 22°C with indoor temperature at 28°C.",
                "options": [
                    {
                        "id": "air_filter",
                        "text": "Verify thermostat is set to COOL mode and 22°C",
                        "correct": true,
                        "explanation": "Correct! Always verify basic settings first. In Australian summer, 22°C is reasonable (though 24-26°C is more energy efficient according to Australian climate guidelines)."
                    },
                    {
                        "id": "air_filter",
                        "text": "Immediately check refrigerant levels",
                        "correct": false,
                        "explanation": "Incorrect. Start with basic checks first. Also, refrigerant work requires an ARC (Australian Refrigeration Council) license in Australia. Let's continue with basic checks."
                    }
                ]
            },
            "air_filter": {
                "id": "air_filter",
                "title": "Air Filter Inspection",
                "description": "Check the air filter condition. In Australian climates, especially Brisbane's humid conditions, filters should be checked every 3 months.",
                "options": [
                    {
                        "id": "outdoor_unit",
                        "text": "Remove and inspect air filter for dust and debris",
                        "correct": true,
                        "explanation": "Correct! Dirty filters are a common cause of poor cooling. In Australia's dusty conditions and humid climates like Brisbane, filters need regular checking (every 3 months)."
                    },
                    {
                        "id": "outdoor_unit",
                        "text": "Skip filter check - it's not important",
                        "correct": false,
                        "explanation": "Incorrect. Dirty filters are one of the most common HVAC problems in Australia. They restrict airflow and reduce cooling efficiency, especially in humid climates. Let's continue anyway."
                    }
                ]
            },
            "outdoor_unit": {
                "id": "outdoor_unit",
                "title": "Outdoor Unit Inspection",
                "description": "Inspect the outdoor unit for issues. Consider Brisbane's climate (Zone 2: warm humid conditions) with current outdoor temperature of 35°C.",
                "options": [
                    {
                        "id": "refrigerant_check",
                        "text": "Check for debris, damaged fins, and proper airflow clearance",
                        "correct": true,
                        "explanation": "Correct! Outdoor units need clear airflow, especially in humid climates like Brisbane. Debris and damaged fins reduce heat exchange efficiency. At 35°C outdoor temperature, proper airflow is critical."
                    },
                    {
                        "id": "refrigerant_check",
                        "text": "Only check if indoor unit has problems",
                        "correct": false,
                        "explanation": "Incorrect. The outdoor unit is critical for heat rejection. In humid climates like Brisbane, it's often the source of cooling problems. Let's continue with the diagnosis."
                    }
                ]
            },
            "refrigerant_check": {
                "id": "refrigerant_check",
                "title": "Refrigerant System Check",
                "description": "Assess refrigerant levels and system pressures. Remember Australian licensing requirements for refrigerant handling.",
                "options": [
                    {
                        "id": "electrical_check",
                        "text": "Check refrigerant levels (ARC license required)",
                        "correct": true,
                        "explanation": "Correct! Low refrigerant is a common issue, but requires an ARC (Australian Refrigeration Council) license to handle refrigerants legally. This is mandatory under Australian law."
                    },
                    {
                        "id": "electrical_check",
                        "text": "Anyone can check refrigerant - no license needed",
                        "correct": false,
                        "explanation": "Incorrect. Australian law requires an ARC license for refrigerant handling. Unlicensed refrigerant work is illegal and can result in significant fines. Let's continue with electrical checks."
                    }
                ]
            },
            "electrical_check": {
                "id": "electrical_check",
                "title": "Electrical Component Check",
                "description": "Test electrical components following Australian safety standards. System shows compressor running but condenser fan not operating.",
                "options": [
                    {
                        "id": "condensate_drain",
                        "text": "Test capacitor, contactors, and fan motors with power isolated",
                        "correct": true,
                        "explanation": "Correct! Following AS/NZS 3000:2018 standards, electrical components should be tested with power properly isolated for safety. Non-functioning condenser fan likely indicates capacitor failure."
                    },
                    {
                        "id": "condensate_drain",
                        "text": "Test components with power on for faster diagnosis",
                        "correct": false,
                        "explanation": "Incorrect. Australian electrical safety standards require proper isolation before testing. Live electrical work is dangerous and often illegal without proper qualifications. Let's continue safely."
                    }
                ]
            },
            "condensate_drain": {
                "id": "condensate_drain",
                "title": "Condensate Drain Check",
                "description": "Check condensate drainage - particularly important in Brisbane's humid climate (65% humidity). Capacitor testing shows 0 µF reading (should be 35 µF).",
                "options": [
                    {
                        "id": "diagnosis_complete",
                        "text": "Replace failed capacitor and check condensate drain",
                        "correct": true,
                        "explanation": "Correct! Failed capacitor (0 µF) is preventing condenser fan operation. In humid climates like Brisbane, condensate drains often block with algae and debris. Both issues need addressing."
                    },
                    {
                        "id": "diagnosis_complete",
                        "text": "Condensate drains don't need checking",
                        "correct": false,
                        "explanation": "Incorrect. Blocked condensate drains are very common in humid Australian climates and can cause water damage and reduced efficiency. However, the main issue is the failed capacitor."
                    }
                ]
            },
            "diagnosis_complete": {
                "id": "diagnosis_complete",
                "title": "Diagnosis Complete",
                "description": "Problem identified: Failed capacitor preventing condenser fan operation. Secondary issue: Condensate drain maintenance needed for Brisbane's humid climate.",
                "options": [
                    {
                        "id": "safety_check",
                        "text": "Practice Another Scenario",
                        "correct": true,
                        "explanation": "Excellent diagnosis! You correctly followed Australian safety protocols, identified the failed capacitor, and considered climate-specific maintenance requirements. Ready for more practice?"
                    }
                ]
            }
        };

        // Step order for progress tracking
        this.stepOrder = ['safety_check', 'thermostat_check', 'air_filter', 'outdoor_unit', 'refrigerant_check', 'electrical_check', 'condensate_drain', 'diagnosis_complete'];
        
        this.stepTitles = {
            'safety_check': 'Safety Protocols',
            'thermostat_check': 'Thermostat Check',
            'air_filter': 'Air Filter Inspection',
            'outdoor_unit': 'Outdoor Unit Inspection',
            'refrigerant_check': 'Refrigerant System Check',
            'electrical_check': 'Electrical Component Check',
            'condensate_drain': 'Condensate Drain Check',
            'diagnosis_complete': 'Diagnosis Complete'
        };

        this.init();
    }

    init() {
        this.bindEventListeners();
        this.renderCurrentStep();
        this.updateProgress();
    }

    bindEventListeners() {
        // Bind restart button
        const restartBtn = document.getElementById('restart-btn');
        if (restartBtn) {
            restartBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.restart();
            });
        }

        // Bind continue button - this needs to be re-bound each time feedback is shown
        this.bindContinueButton();
    }

    bindContinueButton() {
        const continueBtn = document.getElementById('continue-btn');
        if (continueBtn) {
            // Remove any existing event listeners by cloning the node
            const newContinueBtn = continueBtn.cloneNode(true);
            continueBtn.parentNode.replaceChild(newContinueBtn, continueBtn);
            
            newContinueBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.continueToNextStep();
            });
        }
    }

    renderCurrentStep() {
        const step = this.diagnosticSteps[this.currentStep];
        
        if (!step) {
            console.error('Step not found:', this.currentStep);
            return;
        }
        
        // Update step header
        document.getElementById('step-title').textContent = step.title;
        document.getElementById('current-step').textContent = `Step ${this.stepCount}`;
        
        // Update step description - use the base scenario for first step
        if (this.currentStep === 'safety_check') {
            document.getElementById('step-description').textContent = "Air conditioner not cooling properly. Indoor temperature 28°C, thermostat set to 22°C. System has been running for 2 hours.";
        } else {
            document.getElementById('step-description').textContent = step.description;
        }

        // Clear and render options
        const optionsContainer = document.getElementById('options-container');
        optionsContainer.innerHTML = '';

        step.options.forEach((option, index) => {
            const optionButton = document.createElement('button');
            optionButton.className = 'option-button';
            optionButton.textContent = option.text;
            optionButton.setAttribute('data-option-id', option.id);
            optionButton.addEventListener('click', (e) => {
                e.preventDefault();
                this.selectOption(option);
            });
            optionsContainer.appendChild(optionButton);
        });

        // Hide feedback section and reset state
        const feedbackSection = document.getElementById('feedback-section');
        feedbackSection.classList.add('hidden');
        feedbackSection.classList.remove('success', 'error');
        this.isAwaitingFeedback = false;
        this.selectedOption = null;
    }

    selectOption(selectedOption) {
        if (this.isAwaitingFeedback) return;

        this.isAwaitingFeedback = true;
        this.selectedOption = selectedOption;
        
        // Update option buttons to show selection
        const optionButtons = document.querySelectorAll('.option-button');
        optionButtons.forEach(button => {
            button.disabled = true;
            if (button.getAttribute('data-option-id') === selectedOption.id) {
                button.classList.add(selectedOption.correct ? 'correct' : 'incorrect');
            } else {
                button.style.opacity = '0.6';
            }
        });

        // Show feedback
        this.showFeedback(selectedOption);
        
        // Re-bind continue button after feedback is shown
        setTimeout(() => {
            this.bindContinueButton();
        }, 100);
    }

    showFeedback(option) {
        const feedbackSection = document.getElementById('feedback-section');
        const feedbackIcon = document.getElementById('feedback-icon');
        const feedbackTitle = document.getElementById('feedback-title');
        const feedbackExplanation = document.getElementById('feedback-explanation');

        // Set feedback content
        feedbackIcon.className = `feedback-icon ${option.correct ? 'success' : 'error'}`;
        feedbackTitle.textContent = option.correct ? 'Correct!' : 'Not Quite Right';
        feedbackExplanation.textContent = option.explanation;

        // Set feedback section style
        feedbackSection.classList.remove('hidden');
        feedbackSection.classList.add(option.correct ? 'success' : 'error');
        feedbackSection.classList.remove(option.correct ? 'error' : 'success');
    }

    continueToNextStep() {
        if (!this.selectedOption) {
            console.error('No option selected');
            return;
        }

        // Mark current step as completed
        if (!this.completedSteps.includes(this.currentStep)) {
            this.completedSteps.push(this.currentStep);
        }

        // Handle special case for completion - restart scenario
        if (this.currentStep === 'diagnosis_complete' && this.selectedOption.id === 'safety_check') {
            this.restart();
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
        // Reset all application state
        this.currentStep = 'safety_check';
        this.completedSteps = [];
        this.stepCount = 1;
        this.isAwaitingFeedback = false;
        this.selectedOption = null;
        
        // Clear any existing feedback
        const feedbackSection = document.getElementById('feedback-section');
        feedbackSection.classList.add('hidden');
        feedbackSection.classList.remove('success', 'error');
        
        // Re-render the application
        this.renderCurrentStep();
        this.updateProgress();
    }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing Australian HVAC app');
    const app = new AustralianHVACDiagnosticApp();
    
    // Store reference globally for debugging
    window.australianHvacApp = app;
});