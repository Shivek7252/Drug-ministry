let approvedDrugs = [];

export async function loadApprovedDrugs() {
	try {
		const response = await fetch('http://localhost:5001/api/approved-drugs');
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const data = await response.json();
		if (Array.isArray(data.drugs)) approvedDrugs = data.drugs;
	} catch (error) {
		console.warn('Approved drug list unavailable:', error.message);
	}
	return approvedDrugs;
}

export function searchApprovedDrugs(query, limit = 8) {
	const normalizedQuery = query.trim().toLowerCase();
	if (!normalizedQuery) return [];
	return approvedDrugs
		.filter(drug => drug.genericName.toLowerCase().includes(normalizedQuery))
		.slice(0, limit);
}

export function findApprovedDrug(genericName) {
	const normalizedName = genericName.trim().toLowerCase();
	if (!normalizedName) return null;
	return approvedDrugs.find(drug =>
		drug.genericName.trim().toLowerCase() === normalizedName
	) || null;
}
