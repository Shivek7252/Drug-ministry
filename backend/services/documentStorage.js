'use strict';

function newStoredUpload(doc, relativePath) {
  return {
    name: doc?.name,
    size: doc?.size,
    type: doc?.type,
    uploadedAt: doc?.uploadedAt,
    path: relativePath,
    validated: false,
    validationResult: null,
  };
}

module.exports = { newStoredUpload };
