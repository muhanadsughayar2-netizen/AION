// Magic Card - Dedicated print page for Chrome Extension
// This avoids CSP issues with inline scripts

document.addEventListener('DOMContentLoaded', async () => {
  const cardContent = document.getElementById('cardContent');
  const printBtn = document.getElementById('printBtn');
  const copyBtn = document.getElementById('copyBtn');
  
  // Get content from storage
  try {
    const result = await chrome.storage.local.get('magicCardContent');
    if (result.magicCardContent) {
      cardContent.innerHTML = result.magicCardContent;
      // Clear it after reading
      await chrome.storage.local.remove('magicCardContent');
    } else {
      cardContent.innerHTML = '<p>No content available. Please try again from the AI chat.</p>';
    }
  } catch (err) {
    console.error('Failed to load magic card content:', err);
    cardContent.innerHTML = '<p>Failed to load content. Please try again.</p>';
  }
  
  // Print button
  printBtn.addEventListener('click', () => {
    window.print();
  });
  
  // Copy button
  copyBtn.addEventListener('click', async () => {
    try {
      // Copy as rich HTML
      const htmlContent = cardContent.innerHTML;
      const textContent = cardContent.innerText;
      
      // Try to copy both HTML and plain text
      const blob = new Blob([htmlContent], { type: 'text/html' });
      const textBlob = new Blob([textContent], { type: 'text/plain' });
      
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': blob,
          'text/plain': textBlob
        })
      ]);
      
      // Visual feedback
      const originalText = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      copyBtn.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
      setTimeout(() => {
        copyBtn.textContent = originalText;
        copyBtn.style.background = '';
      }, 2000);
    } catch (err) {
      console.error('Copy failed:', err);
      // Fallback to plain text
      try {
        await navigator.clipboard.writeText(cardContent.innerText);
        copyBtn.textContent = 'Copied (text only)';
        setTimeout(() => {
          copyBtn.textContent = 'Copy to Clipboard';
        }, 2000);
      } catch (e) {
        copyBtn.textContent = 'Copy failed';
        setTimeout(() => {
          copyBtn.textContent = 'Copy to Clipboard';
        }, 2000);
      }
    }
  });
});
