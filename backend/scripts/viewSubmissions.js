/**
 * View All Submissions Script
 * 
 * Simple script to view all submissions currently in the database
 * Usage: node scripts/viewSubmissions.js
 */

import { Level } from 'level';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database path
const dbPath = path.join(__dirname, '../data/submissions');
const submissionsDb = new Level(dbPath, { valueEncoding: 'json' });

async function viewSubmissions() {
  console.log('\n📋 All Submissions in Database\n');
  console.log('═'.repeat(120));
  
  try {
    await submissionsDb.open();
    
    const submissions = [];
    for await (const [key, submission] of submissionsDb.iterator()) {
      submissions.push({ id: key, ...submission });
    }
    
    if (submissions.length === 0) {
      console.log('\n  No submissions found in database.\n');
      console.log('  Submissions will be created when users submit through /submit form.\n');
      console.log('═'.repeat(120));
      console.log('\n');
      process.exit(0);
    }
    
    console.log(`\nTotal Submissions: ${submissions.length}\n`);
    
    submissions.forEach((submission, index) => {
      const typeEmoji = submission.submissionType === 'suggest-paper' ? '📄' : '📊';
      const statusEmoji = submission.status === 'pending' ? '⏳' : 
                         submission.status === 'approved' ? '✅' : 
                         submission.status === 'rejected' ? '❌' : '🔄';
      
      console.log(`${typeEmoji} ${statusEmoji} Submission ${index + 1}`);
      console.log(`   ID:          ${submission.id}`);
      console.log(`   Type:        ${submission.submissionType}`);
      console.log(`   Status:      ${submission.status}`);
      console.log(`   Submitted:   ${new Date(submission.submittedAt).toLocaleString()}`);
      console.log(`   User ID:     ${submission.userId}`);
      console.log(`   Email:       ${submission.submitterEmail}`);
      console.log(`   Name:        ${submission.submitterName}`);
      
      if (submission.submissionType === 'suggest-paper') {
        console.log(`   Paper:       ${submission.paperTitle || 'N/A'}`);
        console.log(`   PMID:        ${submission.pmid || 'N/A'}`);
        console.log(`   Journal:     ${submission.journal || 'N/A'}`);
      } else {
        console.log(`   Study:       ${submission.studyName || 'N/A'}`);
        console.log(`   Description: ${submission.description ? submission.description.substring(0, 60) + '...' : 'N/A'}`);
      }
      
      console.log(`   Files:       ${submission.attachmentCount || 0} file(s)`);
      if (submission.attachments && submission.attachments.length > 0) {
        submission.attachments.forEach((file, i) => {
          console.log(`                ${i + 1}. ${file.originalName} (${Math.round(file.size / 1024)} KB)`);
        });
      }
      
      console.log(`   Data Types:  ${submission.dataTypes ? submission.dataTypes.join(', ') : 'N/A'}`);
      console.log(`   Notes:       ${submission.notes ? submission.notes.substring(0, 60) + '...' : 'None'}`);
      console.log('─'.repeat(120));
    });
    
    // Summary by type
    const paperSuggestions = submissions.filter(s => s.submissionType === 'suggest-paper').length;
    const dataSubmissions = submissions.filter(s => s.submissionType === 'submit-data').length;
    
    // Summary by status
    const pending = submissions.filter(s => s.status === 'pending').length;
    const approved = submissions.filter(s => s.status === 'approved').length;
    const rejected = submissions.filter(s => s.status === 'rejected').length;
    const other = submissions.length - pending - approved - rejected;
    
    console.log(`\n📊 Summary:`);
    console.log(`   📄 Paper Suggestions: ${paperSuggestions}`);
    console.log(`   📊 Data Submissions: ${dataSubmissions}`);
    console.log(`   ⏳ Pending: ${pending}`);
    console.log(`   ✅ Approved: ${approved}`);
    console.log(`   ❌ Rejected: ${rejected}`);
    if (other > 0) console.log(`   🔄 Other: ${other}`);
    console.log(`   📝 Total: ${submissions.length}\n`);
    
    console.log('═'.repeat(120));
    console.log('\n');
    
    await submissionsDb.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    await submissionsDb.close();
    process.exit(1);
  }
}

viewSubmissions();
