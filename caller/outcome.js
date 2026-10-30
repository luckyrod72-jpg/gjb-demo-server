const OUTCOMES=['Person answered','AI or answering service answered','Generic voicemail','Custom voicemail','Voicemail full','No answer'];
// Text is used in memory only and never returned, logged or persisted.
function speech(text,business=''){
 const t=String(text).toLowerCase();
 if(/mailbox.{0,30}full|voicemail.{0,30}full|cannot accept.{0,20}messages|not accepting.{0,20}messages/.test(t))return 'Voicemail full';
 if(/virtual assistant|ai assistant|ai receptionist|automated assistant|answering service|digital assistant/.test(t))return 'AI or answering service answered';
 if(/leave.{0,40}message|after the (?:tone|beep)|at the (?:tone|beep)|not available|unavailable|you have reached/.test(t)){
  if(/subscriber|wireless customer|person you (?:are calling|called)|mailbox|automated voice messaging/.test(t)&&!(business&&t.includes(business.toLowerCase())))return 'Generic voicemail';
  return 'Custom voicemail';
 }
 return null;
}
function outcome({label,answeredBy,status}){
 if(OUTCOMES.includes(label))return label;
 if(['busy','no-answer','failed','canceled'].includes(status))return 'No answer';
 if(answeredBy==='human')return 'Person answered';
 // A machine result alone cannot distinguish custom from generic voicemail.
 // Unknown carrier classification is not evidence for any of the six labels.
 return null;
}
module.exports={OUTCOMES,speech,outcome};
