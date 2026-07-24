type FirestoreDocumentNamer = {
  documentName(path: string): string;
};

export function userHistoryWrite(
  firestore: FirestoreDocumentNamer,
  userId: string,
) {
  return {
    update: {
      name: firestore.documentName(`v1UserDirectory/${userId}`),
      fields: {
        emptyShellEligible: { booleanValue: false },
      },
    },
    updateMask: { fieldPaths: ["emptyShellEligible"] },
    currentDocument: { exists: true },
  };
}
