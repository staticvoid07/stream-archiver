const QUOTA_MESSAGE_PATTERN = /exceeded the number of videos|uploadLimitExceeded/i;

function isUploadQuotaError(err) {
  const message = String((err && err.message) || err || '');
  if (QUOTA_MESSAGE_PATTERN.test(message)) return true;
  const reason = err && err.errors && err.errors[0] && err.errors[0].reason;
  return reason === 'uploadLimitExceeded';
}

module.exports = { isUploadQuotaError };
