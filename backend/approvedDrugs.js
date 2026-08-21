// ============================================================
// CDSCO Approved Drugs — backend validation source
// Mirrors frontend/src/data/approvedDrugs.js
// Used by: routes/applications.js submit validation
// ============================================================

const APPROVED_DRUGS = [
  { id: 1, genericName: "Eslicarbazepine Acetate", approvalDate: "07.03.2011" },
  { id: 2, genericName: "2-Sulphanilamide-5-methyl pyrimidine", approvalDate: "1970-01" },
  { id: 3, genericName: "2-thymyloxy methyl Glyoxalidine HCl", approvalDate: "1971-01" },
  { id: 4, genericName: "Acetylcysteine", approvalDate: "1966-03" },
  { id: 5, genericName: "Atenolol (bulk)", approvalDate: "1986-01" },
  { id: 6, genericName: "Azacitidine", approvalDate: "29.04.2014" },
  { id: 7, genericName: "Bromonaphthol", approvalDate: "1963-02" },
  { id: 8, genericName: "Cefprozil", approvalDate: "01.06.2006" },
  { id: 9, genericName: "Cephradine", approvalDate: "1976-03" },
  { id: 10, genericName: "Ciprofloxacin", approvalDate: "1991-02" },
  { id: 11, genericName: "Cyproheptadine", approvalDate: "1973-01" },
  { id: 12, genericName: "Degarelix", approvalDate: "19.01.2012" },
  { id: 13, genericName: "Deoxyribonuclease", approvalDate: "1968-01" },
  { id: 14, genericName: "Dimethindene Maleate", approvalDate: "1965-01" },
  { id: 15, genericName: "Betamethasone (Diprospan)", approvalDate: "1984-07" },
  { id: 16, genericName: "Dobutamine HCl in 5% Dextrose", approvalDate: "01.05.2001" },
  { id: 17, genericName: "Domperidone SR", approvalDate: "16.01.2003" },
  { id: 18, genericName: "Enrofloxacin", approvalDate: "01.10.1994" },
  { id: 19, genericName: "Fenbendazole (bulk)", approvalDate: "1983-01" },
  { id: 20, genericName: "Flavoxate Hydrochloride", approvalDate: "1981" },
  { id: 21, genericName: "Fluprednylidene-21-Acetate", approvalDate: "1978" },
  { id: 22, genericName: "Glimepiride", approvalDate: "24.01.1999" },
  { id: 23, genericName: "Lofepramine", approvalDate: "1990-01" },
  { id: 24, genericName: "Lurasidone Hydrochloride", approvalDate: "04.01.2017" },
  { id: 25, genericName: "Metaraminol Bitartrate", approvalDate: "1964-01" },
  { id: 26, genericName: "Nimesulide", approvalDate: "13.01.1995" },
  { id: 27, genericName: "Nintedanib", approvalDate: "11.03.2016" },
  { id: 28, genericName: "Nitroglycerin Ointment", approvalDate: "1982-01" },
  { id: 29, genericName: "Norfloxacin", approvalDate: "12.03.1997" },
  { id: 30, genericName: "Oxiconazole Nitrate", approvalDate: "17.01.2000" },
  { id: 31, genericName: "Pidotimod", approvalDate: "11.02.2011" },
  { id: 32, genericName: "Practolol", approvalDate: "1974" },
  { id: 33, genericName: "Prothipendyl Hydrochloride", approvalDate: "1962-01" },
  { id: 34, genericName: "Rivaroxaban", approvalDate: "03.02.2010" },
  { id: 35, genericName: "R-Ondansetron", approvalDate: "12.01.2007" },
  { id: 36, genericName: "Ruxolitinib", approvalDate: "28.01.2013" },
  { id: 37, genericName: "Selamectin", approvalDate: "14.01.2009" },
  { id: 38, genericName: "Sofosbuvir", approvalDate: "13.01.2015" },
  { id: 39, genericName: "Tolfenamic Acid", approvalDate: "07.01.2002" },
  { id: 40, genericName: "Tolnaftate", approvalDate: "1969-01" },
  { id: 41, genericName: "Tramadol Hydrochloride", approvalDate: "27.01.1993" },
  { id: 42, genericName: "Tramadol SR", approvalDate: "27.01.1998" },
  { id: 43, genericName: "Trinovum (Triphasic Oral Contraceptive)", approvalDate: "1988-01" },
  { id: 44, genericName: "Tripotassium Dicitrato Bismuthate", approvalDate: "1989-01" },
  { id: 45, genericName: "Trofodermin Cream (Clostebol + Neomycin)", approvalDate: "1985-06" },
  { id: 46, genericName: "Alphachymotrypsin", approvalDate: "1975-07" },
  { id: 47, genericName: "Aripiprazole", approvalDate: "23.02.2004" },
  { id: 48, genericName: "Armodafinil", approvalDate: "23.04.2010" },
  { id: 49, genericName: "Bimatoprost Ophthalmic Solution", approvalDate: "30.03.2009" },
  { id: 50, genericName: "Bismuth Aluminate", approvalDate: "1962-04" },
  { id: 51, genericName: "Brinzolamide", approvalDate: "26.05.2011" },
  { id: 52, genericName: "Canagliflozin", approvalDate: "17.11.2014" },
  { id: 53, genericName: "Ceftriaxone Sodium", approvalDate: "1988-04" },
  { id: 54, genericName: "Chloramphenicol", approvalDate: "1972-10" },
  { id: 55, genericName: "Bleomycin", approvalDate: "1973-12" },
  { id: 56, genericName: "Clenbuterol Hydrochloride", approvalDate: "01.07.2012" },
  { id: 57, genericName: "Clozapine", approvalDate: "07.03.1995" },
  { id: 58, genericName: "Cyclandelate", approvalDate: "1977-07" },
  { id: 59, genericName: "Desloratadine", approvalDate: "14.01.2002" },
  { id: 60, genericName: "Dexchlorpheniramine Maleate", approvalDate: "1976-07" },
  { id: 61, genericName: "Diltiazem Injection", approvalDate: "16.05.1994" },
  { id: 62, genericName: "Etomidate Injection", approvalDate: "1985-08" },
  { id: 63, genericName: "Gonadorelin (6-D-Phe)", approvalDate: "15.06.2016" },
  { id: 64, genericName: "Gugulipid", approvalDate: "1986-06" },
  { id: 65, genericName: "Gugulipid Tablets", approvalDate: "1987-03" },
  { id: 66, genericName: "Mebhydroline Napadisylate", approvalDate: "1964-02" },
  { id: 67, genericName: "Mepartricin", approvalDate: "28.05.1993" },
  { id: 68, genericName: "Miconazole Nitrate", approvalDate: "1979-03" },
  { id: 69, genericName: "Mitoxantrone (bulk)", approvalDate: "1989-03" },
  { id: 70, genericName: "Nalbuphine", approvalDate: "08.02.2007" },
  { id: 71, genericName: "Oral Rehydration Salts (Tablets)", approvalDate: "22.04.1996" },
  { id: 72, genericName: "Orciprenaline Sulphate", approvalDate: "1965-04" },
  { id: 73, genericName: "Pefloxacin Mesylate Dihydrate", approvalDate: "1991-05" },
  { id: 74, genericName: "Pegaptinib Sodium", approvalDate: "06.02.2006" },
  { id: 75, genericName: "Piroxicam Gel", approvalDate: "1990-03" },
  { id: 76, genericName: "Pyridoxine HCl CR Tablet", approvalDate: "07.05.1992" },
  { id: 77, genericName: "Risperidone", approvalDate: "03.04.1997" },
  { id: 78, genericName: "Sodium Meglumine Iothalamate", approvalDate: "1969-07" },
  { id: 79, genericName: "Sodium Polyhydroxy Aluminium Monocarbonate Hexitol Complex", approvalDate: "1963-05" },
  { id: 80, genericName: "Spironolactone", approvalDate: "1961-03" },
  { id: 81, genericName: "Tinidazole Suspension", approvalDate: "1983-12" },
  { id: 82, genericName: "Trifluperidol HCl", approvalDate: "1973-05" },
  { id: 83, genericName: "Vilazodone HCl", approvalDate: "19.08.2015" },
  { id: 84, genericName: "Ceftiofur HCl Liquid Sterile Suspension", approvalDate: "08.10.2002" },
  { id: 85, genericName: "Duloxetine HCl", approvalDate: "02.11.2004" },
  { id: 86, genericName: "Phenylbutazone Calcium", approvalDate: "1963-05" },
  { id: 87, genericName: "Esomeprazole Magnesium", approvalDate: "04.12.2001" },
  { id: 88, genericName: "Imatinib Mesylate", approvalDate: "11.08.2011" },
  { id: 89, genericName: "Lactitol Sachet", approvalDate: "21.11.2005" },
  { id: 90, genericName: "Mebeverine HCl Prolonged Release Capsule", approvalDate: "20.06.2007" },
  { id: 91, genericName: "Lithium Carbonate", approvalDate: "1969-08" },
  { id: 92, genericName: "Pantoprazole Mouth Dissolving Tablet", approvalDate: "30.03.2010" },
  { id: 93, genericName: "Aspirin Bolus (Veterinary)", approvalDate: "21.11.2005" },
  { id: 94, genericName: "Cilnidipine", approvalDate: "21.06.2007" },
  { id: 95, genericName: "Deflazacort", approvalDate: "02.11.2004" },
  { id: 96, genericName: "Dexketoprofen (as Trometamol)", approvalDate: "28.03.2008" },
  { id: 97, genericName: "Fosphenytoin Sodium", approvalDate: "01.10.2002" },
  { id: 98, genericName: "Pravastatin", approvalDate: "09.08.2006" },
  { id: 99, genericName: "Rifaximin", approvalDate: "18.08.2011" },
  { id: 100, genericName: "Ropinirole HCl", approvalDate: "03.12.2001" },
  { id: 101, genericName: "Dexamethasone Tablets", approvalDate: "02.11.2004" },
  { id: 102, genericName: "Hyaluronic Acid Sodium Salt", approvalDate: "31.03.2009" },
  { id: 103, genericName: "Nepafenac Ophthalmic Suspension", approvalDate: "31.03.2008" },
  { id: 104, genericName: "Olanzapine Powder for Oral Suspension", approvalDate: "11.08.2006" },
  { id: 105, genericName: "Tolperisone HCl SR", approvalDate: "30.03.2010" },
  { id: 106, genericName: "Abatacept Injection", approvalDate: "10.04.2009" },
  { id: 107, genericName: "Hylan GF 20 (Synvisc)", approvalDate: "31.03.2008" },
  { id: 108, genericName: "Metaxolone", approvalDate: "08.10.2002" },
  { id: 109, genericName: "Methylphenidate HCl ER", approvalDate: "08.12.2004" },
  { id: 110, genericName: "Acotiamide Hydrochloride", approvalDate: "06.07.2016" },
  { id: 111, genericName: "Pholcodine Syrup", approvalDate: "10.07.2007" },
  { id: 112, genericName: "Atomoxetine HCl", approvalDate: "09.11.2004" },
  { id: 113, genericName: "Soya Protein Derived", approvalDate: "1978-06" },
  { id: 114, genericName: "Docetaxel Injection (Additional Indication)", approvalDate: "31.03.2008" },
  { id: 115, genericName: "Exenatide Injection", approvalDate: "09.07.2007" },
  { id: 116, genericName: "Trimetazidine Modified Release Tablet", approvalDate: "03.12.2001" },
  { id: 117, genericName: "Lamotrigine 25mg MR Tablet (Additional Strength)", approvalDate: "05.04.2010" },
  { id: 118, genericName: "Methotrexate Topical Gel", approvalDate: "25.11.2005" },
  { id: 119, genericName: "Zafirlukast", approvalDate: "03.12.2001" },
  { id: 120, genericName: "Imatinib Mesylate (Additional Indication)", approvalDate: "05.04.2010" },
  { id: 121, genericName: "Meglumine Gadoterate Solution", approvalDate: "23.10.2002" },
  { id: 122, genericName: "Metoprolol Succinate ER Tablets", approvalDate: "29.11.2004" },
  { id: 123, genericName: "Pemetrexed Disodium", approvalDate: "21.08.2006" },
  { id: 124, genericName: "Acamprosate Calcium", approvalDate: "30.10.2002" },
  { id: 125, genericName: "Azithromycin SR Granules 1g", approvalDate: "05.04.2010" },
  { id: 126, genericName: "Milnacipran", approvalDate: "15.04.2009" },
  { id: 127, genericName: "Nicardipine HCl Injection", approvalDate: "07.04.2008" },
  { id: 128, genericName: "Testosterone Transdermal Spray", approvalDate: "30.11.2005" },
  { id: 129, genericName: "Valsartan", approvalDate: "10.12.2001" },
  { id: 130, genericName: "Cefepime HCl for Injection", approvalDate: "30.10.2002" },
  { id: 131, genericName: "Gemfibrozil", approvalDate: "05.04.2010" },
  { id: 132, genericName: "Lornoxicam SR", approvalDate: "25.04.2009" },
  { id: 133, genericName: "Moxifloxacin (Additional Indication)", approvalDate: "27.12.2001" },
  { id: 134, genericName: "Omeprazole Powder for Suspension", approvalDate: "30.11.2005" },
  { id: 135, genericName: "Tiropramide HCl", approvalDate: "22.08.2006" },
  { id: 136, genericName: "Ursodeoxycholic Acid SR Capsules", approvalDate: "01.12.2004" },
  { id: 137, genericName: "Doxazosin ER Tablet", approvalDate: "30.11.2005" },
  { id: 138, genericName: "Eperisone HCl Tablet", approvalDate: "23.08.2006" },
  { id: 139, genericName: "Leuprolide Acetate 3-Month Depot", approvalDate: "03.12.2003" },
  { id: 140, genericName: "Palonosetron HCl", approvalDate: "25.04.2009" },
  { id: 141, genericName: "Tegaserod Maleate", approvalDate: "01.11.2002" },
  { id: 142, genericName: "Topiramate Sprinkle Capsule", approvalDate: "24.12.2001" },
  { id: 143, genericName: "Afatinib", approvalDate: "30.12.2014" },
  { id: 144, genericName: "Apixaban", approvalDate: "03.08.2012" },
  { id: 145, genericName: "Besifloxacin Ophthalmic Suspension", approvalDate: "31.05.2011" },
  { id: 146, genericName: "Carboplatin", approvalDate: "1989-03" },
  { id: 147, genericName: "Cephacetrile Sodium Intramammary Infusion", approvalDate: "13.05.1992" },
  { id: 148, genericName: "Choline Salicylate", approvalDate: "1965-04" },
  { id: 149, genericName: "Ciclesonide Inhaler", approvalDate: "06.02.2006" },
  { id: 150, genericName: "Cinnarizine", approvalDate: "1985-08" },
  { id: 151, genericName: "Ephedrine Sulphate SR", approvalDate: "1971-05" },
  { id: 152, genericName: "Etidronate Disodium", approvalDate: "10.03.1995" },
  { id: 153, genericName: "Etodolac", approvalDate: "10.04.1997" },
  { id: 154, genericName: "Fluoxetine Hydrochloride", approvalDate: "1990-03" },
  { id: 155, genericName: "Formoterol Fumarate", approvalDate: "16.02.2000" },
  { id: 156, genericName: "Gemigliptin", approvalDate: "21.08.2015" },
  { id: 157, genericName: "Hexadimethrine Bromide", approvalDate: "1962-04" },
  { id: 158, genericName: "Ibuprofen", approvalDate: "1979-04" },
  { id: 159, genericName: "Indacaterol (as Maleate) Inhalation Powder", approvalDate: "28.04.2010" },
  { id: 160, genericName: "Indinavir Sulphate", approvalDate: "02.02.2001" },
  { id: 161, genericName: "Ketoprofen", approvalDate: "1981-04" },
  { id: 162, genericName: "Levobunolol Hydrochloride Ophthalmic Solution", approvalDate: "16.05.1996" },
  { id: 163, genericName: "Levonorgestrel", approvalDate: "07.02.2007" },
  { id: 164, genericName: "Luprostiol Injection", approvalDate: "1986-06" },
  { id: 165, genericName: "Minoxidil Topical Lotion", approvalDate: "1988-05" },
  { id: 166, genericName: "Nabumetone", approvalDate: "17.05.1999" },
  { id: 167, genericName: "Nicoumalone", approvalDate: "18.01.2013" },
  { id: 168, genericName: "Ofloxacin Infusion", approvalDate: "1991-05" },
  { id: 169, genericName: "Oxcarbazepine", approvalDate: "14.01.2002" },
  { id: 170, genericName: "Oxethazaine HCl", approvalDate: "1967-06" },
  { id: 171, genericName: "Pentoxifylline", approvalDate: "1977-08" },
  { id: 172, genericName: "Phenprobamate", approvalDate: "1964-03" },
  { id: 173, genericName: "Sertraline HCl", approvalDate: "23.02.2004" },
  { id: 174, genericName: "Terconazole Vaginal Ovule/Cream", approvalDate: "19.07.1994" },
  { id: 175, genericName: "Paracetamol Bilayer Tablet", approvalDate: "11.04.2012" },
  { id: 176, genericName: "Trabectedin", approvalDate: "01.04.2009" },
  { id: 177, genericName: "Tretinoin", approvalDate: "1974-07" },
  { id: 178, genericName: "Triethanalamine Trinitrate Bisphosphate", approvalDate: "1961-03" },
  { id: 179, genericName: "Trimetazidine Dihydrochloride", approvalDate: "1980-06" },
  { id: 180, genericName: "Trimipramine", approvalDate: "1968-09" },
  { id: 181, genericName: "Trofosfamide", approvalDate: "1976-08" },
  { id: 182, genericName: "Virginiamycin", approvalDate: "1975-07" },
  { id: 183, genericName: "Capecitabine (Additional Indication)", approvalDate: "16.07.2007" },
  { id: 184, genericName: "Caroverine", approvalDate: "28.08.2006" },
  { id: 185, genericName: "Feracrylum Solution", approvalDate: "21.05.1992" },
  { id: 186, genericName: "Fentanyl Citrate Transmucosal Tablet", approvalDate: "29.10.2002" },
  { id: 187, genericName: "Hylan GF 20 Injection", approvalDate: "20.12.2001" },
  { id: 188, genericName: "Rabeprazole Sodium EC Pellets", approvalDate: "16.04.2008" },
  { id: 189, genericName: "Zoledronic Acid Injection (Additional Indication)", approvalDate: "29.11.2004" },
  { id: 190, genericName: "Dosulepin HCl", approvalDate: "08.04.2010" },
  { id: 191, genericName: "Leflunomide", approvalDate: "29.11.2004" },
  { id: 192, genericName: "Live Freeze-dried Lactic Acid Bacteria and Bifidobacteria", approvalDate: "10.04.2008" },
  { id: 193, genericName: "Nitrous Oxide Pre-mixed Gas", approvalDate: "20.12.2001" },
  { id: 194, genericName: "Paclitaxel Nanoparticle", approvalDate: "23.08.2006" },
  { id: 195, genericName: "Rifabutin", approvalDate: "19.07.2007" },
  { id: 196, genericName: "Docetaxel Injection (80mg/2ml, Additional Indication)", approvalDate: "2004" },
  { id: 197, genericName: "Lapatinib (as Ditosylate)", approvalDate: "24.07.2007" },
  { id: 198, genericName: "Miltefosine (Additional Indication)", approvalDate: "16.04.2008" },
  { id: 199, genericName: "Phenylephrine 2.5% Eye Drops", approvalDate: "02.12.2005" },
  { id: 200, genericName: "Rabeprazole Sodium", approvalDate: "27.12.2001" },
  { id: 201, genericName: "Ranolazine ER", approvalDate: "24.04.2010" },
  { id: 202, genericName: "Pregabalin SR", approvalDate: "16.05.2009" },
  { id: 203, genericName: "Betaxolol Ophthalmic Gel", approvalDate: "25.10.2002" },
  { id: 204, genericName: "Calcium Polycarbophil Tablets", approvalDate: "2004-12" },
  { id: 205, genericName: "Entecavir", approvalDate: "05.12.2005" },
  { id: 206, genericName: "Levocetirizine Di-HCl Mouth Dissolving Tablet", approvalDate: "27.07.2007" },
  { id: 207, genericName: "Rifaximin", approvalDate: "28.08.2006" },
  { id: 208, genericName: "Tacrolimus Capsules", approvalDate: "24.04.2010" },
  { id: 209, genericName: "Aztreonam", approvalDate: "01.11.2002" },
  { id: 210, genericName: "Edaravone Injection", approvalDate: "26.07.2007" },
  { id: 211, genericName: "Nicotine Transdermal Patch", approvalDate: "11.01.2001" },
  { id: 212, genericName: "Nilutamide (Additional Strength)", approvalDate: "2004-12" },
  { id: 213, genericName: "Sertaconazole Nitrate", approvalDate: "02.05.2009" },
  { id: 214, genericName: "Tigecycline", approvalDate: "28.08.2006" },
  { id: 215, genericName: "Amlodipine (Additional Indication)", approvalDate: "02.05.2009" },
  { id: 216, genericName: "Balsalazide Disodium", approvalDate: "12.11.2002" },
  { id: 217, genericName: "Clostridium Botulinum Type-A Toxin (Additional Indication)", approvalDate: "22.04.2008" },
  { id: 218, genericName: "Diclofenac Sodium 75mg/ml Injection (Additional Strength)", approvalDate: "30.07.2007" },
  { id: 219, genericName: "Ramipril Tablets (Additional Indication)", approvalDate: "2004-12" },
  { id: 220, genericName: "Stavudine SR", approvalDate: "29.08.2006" },
  { id: 221, genericName: "Imedeen Oral Tablets", approvalDate: "2005-10" },
  { id: 222, genericName: "Cefetamet Pivoxil", approvalDate: "14.11.2002" },
  { id: 223, genericName: "Clindamycin Phosphate (Additional Indication)", approvalDate: "02.05.2009" },
  { id: 224, genericName: "Fluconazole Dispersible Tablets", approvalDate: "22.04.2008" },
  { id: 225, genericName: "Imiquimod Topical Cream", approvalDate: "29.12.2004" },
  { id: 226, genericName: "Thiocolchicoside SR Tablet", approvalDate: "30.04.2010" },
  { id: 227, genericName: "Broncho Vaxom Capsules (Bacterial Lysate)", approvalDate: "12.02.2001" },
  { id: 228, genericName: "Lenalidomide (Additional Indication)", approvalDate: "22.04.2008" },
  { id: 229, genericName: "Parecoxib Injection", approvalDate: "01.11.2002" },
  { id: 230, genericName: "Travoprost Eye Drops", approvalDate: "08.12.2005" },
  { id: 231, genericName: "Alprazolam Sublingual Tablets", approvalDate: "27.10.2011" },
  { id: 232, genericName: "Sucralose", approvalDate: "09.05.2009" },
  { id: 233, genericName: "Neotame (Sweetening Agent)", approvalDate: "2004-03" },
  { id: 234, genericName: "Verteporfin", approvalDate: "20.03.2001" },
  { id: 235, genericName: "Abacavir Sulphate Syrup", approvalDate: "29.08.2006" },
  { id: 236, genericName: "Carvedilol Tablets (Additional Indication)", approvalDate: "09.05.2009" },
  { id: 237, genericName: "Cetrorelix Acetate Injection", approvalDate: "22.03.2001" },
  { id: 238, genericName: "Gemcitabine HCl for Injection 2g (New Dosage Form)", approvalDate: "27.10.2011" },
  { id: 239, genericName: "Lansoprazole Injection", approvalDate: "28.04.2008" },
  { id: 240, genericName: "Lapatinib Ditosylate (Additional Indication)", approvalDate: "10.05.2010" },
  { id: 241, genericName: "Telmisartan", approvalDate: "25.11.2002" },
  { id: 242, genericName: "VSL#3 (Probiotic Blend)", approvalDate: "31.07.2007" },
  { id: 243, genericName: "Amikacin Injection", approvalDate: "1986-06" },
  { id: 244, genericName: "Azacitidine Injection", approvalDate: "01.09.2015" },
  { id: 245, genericName: "Benzydamine Topical Cream", approvalDate: "1988-05" },
  { id: 246, genericName: "Betamethasone Benzoate", approvalDate: "1978-08" },
  { id: 247, genericName: "Biperiden Lactate Injection", approvalDate: "1972-10" },
  { id: 248, genericName: "Brimonidine Tartrate Ophthalmic Solution", approvalDate: "18.05.1999" },
  { id: 249, genericName: "Celecoxib", approvalDate: "22.02.2000" },
  { id: 250, genericName: "Clonidine HCl", approvalDate: "1975-07" },
];

// ── Build a lowercase lookup Set for O(1) validation ──────────────────────
const APPROVED_NAMES_SET = new Set(
  APPROVED_DRUGS.map(d => d.genericName.toLowerCase().trim())
);

/**
 * Check if a generic name is CDSCO-approved.
 * Does a case-insensitive exact match first, then a substring check
 * (catches "Imatinib Mesylate 100mg" when list has "Imatinib Mesylate").
 *
 * @param {string} genericName
 * @returns {{ approved: boolean, matchedName: string|null, approvalDate: string|null }}
 */
function checkApproval(genericName) {
  if (!genericName || typeof genericName !== 'string') {
    return { approved: false, matchedName: null, approvalDate: null };
  }
  const q = genericName.trim().toLowerCase();

  // Exact match
  if (APPROVED_NAMES_SET.has(q)) {
    const drug = APPROVED_DRUGS.find(d => d.genericName.toLowerCase().trim() === q);
    return { approved: true, matchedName: drug.genericName, approvalDate: drug.approvalDate };
  }

  // Substring: approved name is contained in submitted name (e.g. strength appended)
  const substringMatch = APPROVED_DRUGS.find(d =>
    q.includes(d.genericName.toLowerCase().trim()) ||
    d.genericName.toLowerCase().trim().includes(q)
  );
  if (substringMatch) {
    return {
      approved: true,
      matchedName: substringMatch.genericName,
      approvalDate: substringMatch.approvalDate,
    };
  }

  return { approved: false, matchedName: null, approvalDate: null };
}

/**
 * Validate all products in a submitted application.
 * Returns an object with:
 *   - valid: boolean  (true only if ALL products are approved)
 *   - results: array of per-product check results
 *   - unapprovedProducts: array of genericNames that failed
 *   - warnings: human-readable strings (one per unapproved product)
 *
 * Policy: We WARN (not block) by default so legitimate edge cases aren't
 * hard-rejected. The caller decides whether to block or flag.
 */
function validateProductsApproval(products) {
  if (!Array.isArray(products) || products.length === 0) {
    return { valid: false, results: [], unapprovedProducts: [], warnings: ['No products provided'] };
  }

  const results = products.map((p, idx) => {
    const name = (p.genericName || '').trim();
    const check = checkApproval(name);
    return {
      index: idx,
      productName: p.productName || '',
      genericName: name,
      ...check,
    };
  });

  const unapprovedProducts = results
    .filter(r => !r.approved)
    .map(r => r.genericName || `Product #${r.index + 1}`);

  const warnings = unapprovedProducts.map(
    name => `"${name}" is not found in the CDSCO approved drugs list. Ensure valid documentation is attached.`
  );

  return {
    valid: unapprovedProducts.length === 0,
    results,
    unapprovedProducts,
    warnings,
  };
}

module.exports = { APPROVED_DRUGS, checkApproval, validateProductsApproval };
