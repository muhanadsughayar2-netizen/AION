/**
 * =====================================================
 * SNAPTOAI MAGIC BUTTON PROMPTS - FULL CONTROL
 * =====================================================
 * 
 * Edit ANY prompt below to customize AI behavior.
 * Just change the text inside the quotes!
 * 
 * Format: "Button Name": "Your prompt text here"
 * 
 * Categories: MONEY | WORK | HEALTH | LEARN
 * =====================================================
 */

window.SNAPTOAI_PROMPTS = {

  // =====================================================
  // MONEY CATEGORY (4 templates)
  // =====================================================
  
  "Stock Deep Dive": "DEEP STOCK ANALYSIS: 1) Extract ticker symbol, current price, and % change. 2) Identify support/resistance levels from the chart. 3) Read any visible news headlines and rate sentiment (bullish/bearish/neutral). 4) Check volume patterns for unusual activity. 5) Give me: a) Entry price recommendation b) Stop-loss level c) Take-profit target d) Risk score 1-10 e) 7-day price prediction with reasoning. Be specific with numbers, not vague.",

  "Deal or No Deal": "DEAL HUNTER ANALYSIS: 1) Identify the product and exact model. 2) Note the current price and any discounts shown. 3) Check for hidden costs (shipping, taxes, subscriptions). 4) Rate the deal quality: STEAL / GOOD / FAIR / RIP-OFF. 5) Estimate typical price range for this item. 6) Red flags to watch for. 7) VERDICT: Buy now, wait for sale, or skip entirely. Include specific dollar amounts.",

  "Crypto Scanner": "CRYPTO SIGNAL ANALYSIS: 1) Identify coin/token and current price. 2) Read the chart pattern (head & shoulders, cup & handle, etc). 3) Check RSI/MACD if visible. 4) Whale activity indicators. 5) Give me: a) Short-term trend (24h) b) Entry zone c) Stop-loss d) Target prices (3 levels) e) Risk rating HIGH/MEDIUM/LOW. No disclaimers - just the analysis.",

  "Bill Detective": "INVOICE/BILL AUDIT: 1) Extract all line items and amounts. 2) Verify math - do totals add up correctly? 3) Flag any suspicious charges, hidden fees, or duplicates. 4) Compare rates to typical market prices. 5) Calculate potential savings if overcharged. 6) Priority items to dispute. 7) Script for calling customer service to negotiate.",

  // =====================================================
  // WORK CATEGORY (4 templates)
  // =====================================================
  
  "Code Doctor": "CODE REVIEW PRO: 1) Identify the programming language and framework. 2) Find bugs, logic errors, and edge cases. 3) Security vulnerabilities (SQL injection, XSS, etc). 4) Performance bottlenecks and optimization opportunities. 5) Code smell and maintainability issues. 6) Rate code quality 1-100. 7) Provide FIXED code snippets for each issue found. Priority: CRITICAL > HIGH > MEDIUM > LOW.",

  "UI/UX Roast": "UI/UX ROAST: 1) First impression score (1-10). 2) Visual hierarchy - where does eye go first? 3) Accessibility issues (contrast, font size, touch targets). 4) Mobile responsiveness concerns. 5) Conversion killers - what stops users from clicking? 6) 3 specific improvements with mockup descriptions. 7) Competitor comparison if recognizable. Be brutally honest but constructive.",

  "Debug This": "ERROR DEBUGGER: 1) Parse the error message and stack trace. 2) Identify root cause (not just symptoms). 3) Explain WHY this error occurred in plain English. 4) Provide the exact fix with code. 5) How to prevent this in the future. 6) Related errors to watch for. 7) Test cases to verify the fix works.",

  "Contract Red Flags": "CONTRACT SCANNER: 1) Identify document type (lease, NDA, employment, etc). 2) Extract key terms, dates, and amounts. 3) Flag concerning clauses in RED. 4) Unusual or non-standard terms. 5) What's missing that should be there. 6) Negotiation points ranked by importance. 7) Plain English summary of what you're agreeing to.",

  // =====================================================
  // HEALTH CATEGORY (4 templates)
  // =====================================================
  
  "Med Check": "MEDICATION ANALYZER: 1) Identify the medication name and dosage. 2) What it's commonly prescribed for. 3) Common side effects to watch for. 4) Serious side effects requiring immediate attention. 5) Drug interactions to avoid (especially common ones). 6) Food/drink restrictions. 7) Questions to ask your doctor. 8) Generic alternatives that could save money.",

  "Food Label Truth": "NUTRITION DETECTIVE: 1) Identify the food product. 2) Parse the nutrition label completely. 3) Hidden sugars and unhealthy ingredients. 4) Marketing tricks vs reality. 5) Rate healthiness 1-100 for different goals (weight loss, muscle, heart). 6) Better alternatives in the same category. 7) VERDICT: Healthy choice, occasional treat, or avoid.",

  "Symptom Guide": "SYMPTOM MAPPER (Educational Only): 1) List all visible symptoms or reported issues. 2) Possible conditions that match (most to least common). 3) Warning signs that need immediate attention. 4) Questions a doctor would likely ask. 5) Tests that might be recommended. 6) Self-care steps while waiting for appointment. Disclaimer: This is educational, not medical advice.",

  "Form Checker": "FITNESS FORM CHECK: 1) Identify the exercise being performed. 2) Evaluate form and technique - what's correct and what's wrong. 3) Injury risks from improper form. 4) Muscles being targeted vs muscles that SHOULD be targeted. 5) Specific corrections with descriptions. 6) Easier and harder progressions. 7) Common mistakes people make with this exercise.",

  // =====================================================
  // LEARN CATEGORY (4 templates)
  // =====================================================
  
  "Study Extractor": "STUDY NOTES GENERATOR: 1) Identify the subject and topic. 2) Extract KEY CONCEPTS (bullet points). 3) Important formulas, dates, or facts to memorize. 4) Create 5 flashcard Q&As. 5) Mnemonic devices to remember complex info. 6) How this connects to related topics. 7) 3 practice questions with answers. 8) One-paragraph summary for quick review.",

  "ELI5 This": "EXPLAIN LIKE I'M 5: 1) Identify what's confusing in this image. 2) Explain the core concept using simple analogies. 3) Real-world example anyone can understand. 4) Common misconceptions about this topic. 5) Why it matters in everyday life. 6) One sentence summary a child could understand.",

  "Compare These": "COMPARISON MATRIX: 1) Identify the items being compared. 2) Create a feature-by-feature comparison table. 3) Pros and cons of each option. 4) Best for different use cases (budget, performance, beginners). 5) Hidden differences most people miss. 6) WINNER for each category. 7) Overall recommendation with reasoning.",

  "Language Helper": "LANGUAGE LEARNING: 1) Identify the language and text. 2) Translate to English. 3) Break down grammar structure. 4) Key vocabulary with pronunciation hints. 5) Cultural context if relevant. 6) Similar phrases to learn. 7) Common mistakes English speakers make with this."

};


/**
 * =====================================================
 * AI BEHAVIOR & CARD SETTINGS
 * =====================================================
 * 
 * Control how the AI responds and formats answers.
 * =====================================================
 */

window.SNAPTOAI_CONFIG = {

  // --- SYSTEM PROMPTS (How the AI behaves) ---
  
  SYSTEM_PROMPT: "You are a thorough, exhaustive AI assistant. Your goal is to provide the COMPLETE answer in a single response. Never stop mid-thought. Never ask the user if they want more—just give it all now. If the answer is long, structure it with headers. Be warm, friendly and thorough. Use **bold text** for emphasis and bullet lists for clarity. Format responses with markdown. End with a helpful follow-up question.",

  SMART_SYSTEM_PROMPT: "You are a thorough, exhaustive AI assistant. I am providing you with the raw text of a webpage for accuracy, and the screenshot of that page for visual context (charts, layout, images). Please use the text for your primary analysis and the images to confirm visual details. Your goal is to provide the COMPLETE answer in a single response. Never stop mid-thought. Never truncate. If the answer is long, structure it with headers. Be warm, friendly and thorough. Use **bold text** for emphasis and bullet lists for clarity. Format responses with markdown. End with a helpful follow-up question.",

  MULTI_IMAGE_PROMPT: "You are a thorough, exhaustive AI assistant. I am providing you with multiple screenshots that together show the full picture. Please analyze ALL images together to understand the complete context. Your goal is to provide the COMPLETE answer in a single response. Never stop mid-thought. Never truncate. If the answer is long, structure it with headers. Be warm, friendly and thorough. Use **bold text** for emphasis and bullet lists for clarity. Format responses with markdown. End with a helpful follow-up question.",

  // --- TOKEN LIMITS (How long AI responses can be) ---
  // Gemini free tier max = 4096. Lower = cheaper/faster. Higher = more complete.
  
  MAX_OUTPUT_TOKENS: 2048,           // Normal chat responses
  MAX_OUTPUT_TOKENS_MAGIC: 4096,     // Magic Button responses (full analysis)
  MAX_OUTPUT_TOKENS_VERDICT: 300,    // Quick verdict responses
  MAX_OUTPUT_TOKENS_BATCH: 1500,     // Batch processing (large captures)

  // --- AI CREATIVITY (Temperature: 0 = precise, 1 = creative) ---
  
  TEMPERATURE: 0.7,                  // Default creativity level

  // --- MAGIC CARD FORMATTING ---
  // Instructions for how AI formats Magic Button responses
  
  MAGIC_CARD_INSTRUCTIONS: `
IMPORTANT: You must respond with a JSON object in this EXACT format (no markdown code blocks, just raw JSON):
{
  "title": "Brief title of analysis",
  "emoji": "Single relevant emoji",
  "score": 85,
  "scoreLabel": "What the score means (e.g., 'Quality Score', 'Risk Level')",
  "tone": "green OR gold OR red",
  "highlight": "One-line key insight",
  "sections": [
    {
      "label": "Section Name",
      "items": ["Point 1", "Point 2", "Point 3"]
    }
  ],
  "actions": [
    {"num": 1, "text": "First recommended action"},
    {"num": 2, "text": "Second recommended action"},
    {"num": 3, "text": "Third recommended action"}
  ],
  "verdict": "Final recommendation in 1-2 sentences",
  "nextQuestion": "Follow-up question to ask"
}

Use "green" tone for positive/good results, "gold" for neutral/caution, "red" for negative/warning.
Score should be 0-100 where relevant.
Include 2-4 sections with 2-5 items each.
Include 2-4 action items.
`,

  // --- VERDICT BUTTON PROMPT ---
  
  VERDICT_PROMPT: "Look at this screenshot and give me ONE WORD verdict (like BUY, SELL, HOLD, YES, NO, SKIP, or similar) followed by a confidence percentage and ONE sentence explanation. Be decisive.",

  // --- RATE LIMIT SETTINGS (for large captures) ---
  
  MAX_IMAGES_PER_REQUEST: 30,        // How many images to send at once
  BATCH_DELAY_MS: 2000               // Wait time between batches (ms)

};
